#!/usr/bin/env node
/**
 * Compares Gaia's event registry export (docs/generated/events.json) with the
 * Hermes event allowlist, and exits non-zero when they drift.
 *
 * Usage: node scripts/check-event-registry.js <path-or-url-to-events.json>
 */
const fs = require('fs');
const { EVENT_ALLOWLIST, USER_SCOPED_EVENTS } = require('../src/contract');

/**
 * Returns the names Hermes must allow, and those it must treat as user-scoped,
 * from the registry entries.
 *
 * @method expectedFromRegistry
 * @param {Array<Object>} registry Parsed events.json
 * @returns {{allowlist: Array<String>, userScoped: Array<String>}}
 */
function expectedFromRegistry(registry) {
	const relayed = registry.filter((event) =>
		event.enabled && Array.isArray(event.channels) && event.channels.includes('hermes'));
	return {
		allowlist: relayed.map((event) => event.name),
		userScoped: relayed
			.filter((event) => Array.isArray(event.scopes) && event.scopes.includes('user'))
			.map((event) => event.name)
	};
}

function diff(label, expected, actual) {
	const lines = [];
	const have = new Set(actual);
	const want = new Set(expected);
	for (const name of [...want].filter((n) => !have.has(n)).sort()) {
		lines.push(`${label}: missing in Hermes: ${name}`);
	}
	for (const name of [...have].filter((n) => !want.has(n)).sort()) {
		lines.push(`${label}: extra in Hermes (not in Gaia registry): ${name}`);
	}
	return lines;
}

/**
 * Returns the list of differences between the registry and the local contract.
 *
 * @method compareRegistry
 * @param {Array<Object>} registry Parsed events.json
 * @param {Iterable<String>} allowlist Hermes allowlist
 * @param {Iterable<String>} userScoped Hermes user-scoped events
 * @returns {Array<String>} Empty when they match
 */
function compareRegistry(registry, allowlist = EVENT_ALLOWLIST, userScoped = USER_SCOPED_EVENTS) {
	const expected = expectedFromRegistry(registry);
	return [
		...diff('EVENT_ALLOWLIST', expected.allowlist, [...allowlist]),
		...diff('USER_SCOPED_EVENTS', expected.userScoped, [...userScoped])
	];
}

async function load(source) {
	if (/^https?:\/\//.test(source)) {
		const response = await fetch(source);
		if (!response.ok) {
			throw new Error(`GET ${source} failed: ${response.status}`);
		}
		return response.json();
	}
	return JSON.parse(fs.readFileSync(source, 'utf8'));
}

async function main(argv) {
	if (!argv[0]) {
		console.error('usage: check-event-registry.js <path-or-url-to-events.json>');
		return 2;
	}
	const differences = compareRegistry(await load(argv[0]));
	if (differences.length) {
		console.error(differences.join('\n'));
		console.error('Hermes allowlist and Gaia event registry differ.');
		return 1;
	}
	console.log('Hermes allowlist matches the Gaia event registry.');
	return 0;
}

if (require.main === module) {
	main(process.argv.slice(2)).then(
		(code) => process.exit(code),
		(error) => { console.error(error.message); process.exit(2); }
	);
}

module.exports = { compareRegistry, expectedFromRegistry };
