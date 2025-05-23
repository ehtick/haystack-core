/*
 * Copyright (c) 2020, J2 Innovations. All Rights Reserved
 */

/* eslint @typescript-eslint/no-explicit-any: "off" */

import { EvalContext } from '../../filter/EvalContext'
import { HFilter } from '../../filter/HFilter'
import { Node } from '../../filter/Node'
import { HaysonDict, HaysonVal } from '../hayson'
import { HDateTime } from '../HDateTime'
import { HGrid } from '../grid/HGrid'
import { HList } from '../list/HList'
import { HMarker } from '../HMarker'
import { HNamespace, Reflection } from '../HNamespace'
import { HRemove } from '../HRemove'
import {
	AXON_NULL,
	HVal,
	isHVal,
	NOT_SUPPORTED_IN_FILTER_MSG,
	OptionalHVal,
	valueEquals,
	valueIsKind,
	ZINC_NULL,
} from '../HVal'
import { JsonV3Dict, JsonV3Val } from '../jsonv3'
import { Kind } from '../Kind'
import { makeValue, dictToDis, LocalizedCallback } from '../util'
import { DictHValObjStore, toHValObj } from './DictHValObjStore'
import { DictStore, isDictStore } from './DictStore'
import { HValObj } from './HValObj'

/**
 * A haystack value row used for iteration.
 */
export interface HValRow {
	name: string
	value: OptionalHVal
}

/**
 * An iterator for a haystack values.
 */
export class DictValueIterator implements Iterator<HValRow> {
	private readonly $values: HValObj

	private readonly $keys: string[]

	private $index = 0

	constructor(dict: HDict) {
		// Make a defensive copy so the iterator doesn't screw up
		// if the dict is modified.
		this.$values = dict.toObj()
		this.$keys = Object.keys(this.$values)
	}

	next(): IteratorResult<HValRow> {
		if (this.$index >= this.$keys.length) {
			return {
				done: true,
				value: undefined,
			}
		}

		const name = this.$keys[this.$index++]

		return {
			done: false,
			value: {
				name,
				value: this.$values[name],
			},
		}
	}
}

/**
 * A mutable haystack dict that also implements the JavaScript Proxy pattern.
 *
 * ```typescript
 * const dict = new HDict({ foo: HStr.make('alpha') })
 *
 * // Write 'beta'
 * dict.set('foo', HStr.make('beta'))
 *
 * // Read 'beta'
 * console.log(dict.get('foo'))
 * ```
 *
 * A dict is also iterable...
 * ```typescript
 * // Iterate a dict
 * for (let row of dict) {
 *   console.log(row.name)
 *   console.log(row.value)
 * }
 *
 * // Use a haystack filter to test for properties...
 * console.log(dict.matches('foo == "beta"')) // prints true
 * ```
 */
export class HDict implements HVal, Iterable<HValRow> {
	/**
	 * The dict values.
	 */
	private readonly $store: DictStore;

	/**
	 * Readonly key access.
	 */
	readonly [prop: string]: unknown | undefined

	/**
	 * Readonly numerical index access.
	 */
	readonly [prop: number]: { name: string; value: OptionalHVal } | undefined

	/**
	 * Create a dict using a set of object values.
	 *
	 * There are multiple ways to create a dict...
	 *
	 * ```typescript
	 * // Create an empty dict
	 * const dict0 = new HDict()
	 *
	 * // Create a dict from a bunch of key haystack value pairs
	 * const dict1 = new HDict({ foo: HStr.make('foovalue;), boo: HNum.make(123) })
	 *
	 * // Same but with Hayson
	 * const dict2 = new HDict({ foo: 'foovalue', boo: 123 })
	 *
	 * // Create a grid from any haystack value...
	 * const dict3 = new HDict(HStr.make('foovalue')) // Create with one row and one column as 'val'.
	 * ```
	 *
	 * @param values dict values to create a dict with.
	 * @returns A dict.
	 */
	constructor(
		values?:
			| { [prop: string]: OptionalHVal | HaysonVal }
			| OptionalHVal
			| DictStore
	) {
		if (isDictStore(values)) {
			this.$store = values
		} else {
			let hvalObjs: HValObj

			if (isHVal(values) || values === null) {
				if (valueIsKind<HDict>(values, Kind.Dict)) {
					hvalObjs = values.toObj()
				} else if (valueIsKind<HGrid>(values, Kind.Grid)) {
					hvalObjs = {}
					for (let i = 0; i < values.length; ++i) {
						hvalObjs[`row${i}`] = values.get(i) as OptionalHVal
					}
				} else {
					hvalObjs = { val: values }
				}
			} else if (values) {
				hvalObjs = toHValObj(values)
			} else {
				hvalObjs = {}
			}

			this.$store = new DictHValObjStore(hvalObjs)
		}

		return this.makeProxy()
	}

	/**
	 * Implement proxy to make it easy to get and set internal values.
	 */
	private makeProxy(): HDict {
		const handler = {
			get: function (target: HDict, prop: string): any {
				const anyTarget = target as any
				if (typeof prop === 'string' && anyTarget[prop] === undefined) {
					// Handle numeric index access for lodash.
					if (!target.has(prop) && /^[0-9]+$/.test(prop)) {
						const name = target.keys[Number(prop)]
						if (name) {
							return {
								name,
								value: target.get(name),
							}
						}
					}
					return target.get(prop)
				}
				return anyTarget[prop] as any
			},
			set(target: HDict, prop: string, value: any): boolean {
				const anyTarget = target as any
				if (typeof prop === 'string' && anyTarget[prop] === undefined) {
					target.set(prop, value)
				} else {
					anyTarget[prop] = value
				}
				return true
			},
		}
		return new Proxy(this, handler)
	}

	/**
	 * Make a dict using a set of object values.
	 *
	 * @param values dict values to create a dict with.
	 * @returns A dict.
	 */
	static make<T extends HDict>(
		values?: { [prop: string]: OptionalHVal | HaysonVal } | OptionalHVal
	): T {
		return (
			valueIsKind<HDict>(values, Kind.Dict) ? values : new HDict(values)
		) as T
	}

	/**
	 * @returns The value's kind.
	 */
	getKind(): Kind {
		return Kind.Dict
	}

	/**
	 * Compares the value's kind.
	 *
	 * @param kind The kind to compare against.
	 * @returns True if the kind matches.
	 */
	isKind(kind: Kind): boolean {
		return valueIsKind<HDict>(this, kind)
	}

	/**
	 * Returns a haystack value from the dict or undefined
	 * if it can't be found.
	 *
	 * ```typescript
	 * // Gets the value as an HVal so cast to an HStr.
	 * const str = dict.get('foo') as HStr
	 *
	 * if (str) {
	 *   // Do something.
	 * }
	 *
	 * // Method is generic to make it easier on the eye for casting.
	 * const str1 = dict.get<HStr>('foo')
	 * ```
	 *
	 * @param name The name of the value to find.
	 * @return The value or undefined if it can't be found.
	 */
	get<Value extends OptionalHVal>(name: string): Value | undefined {
		return this.$store.get(name) as Value | undefined
	}

	/**
	 * Set a haystack value.
	 *
	 * ```typescript
	 * dict.set('foo', HStr.make('New value'))
	 *
	 * // Set the value using Hayson
	 * dict.set('foo', 'New value')
	 * ```
	 *
	 * @param name The name to set.
	 * @param value The haystack value to set.
	 * @returns The dict instance.
	 */
	set(name: string, value: HVal | HaysonVal | null): this {
		this.$store.set(name, makeValue(value))
		return this
	}

	/**
	 * Update a dict from another dict(s) or Hayson dict(s).
	 *
	 * ```typescript
	 * dict.update(otherDict, anotherDict)
	 *
	 * // Update using a Hayson object
	 * dict.update({ dis: 'A new display string', curVal: 20 })
	 * ```
	 *
	 * @param dicts The dicts to update from.
	 * @returns The dict instance.
	 */
	update(...dicts: (HDict | HaysonDict)[]): this {
		for (const dict of dicts) {
			const updateDict = makeValue(dict) as HDict
			for (const name of updateDict.keys) {
				const val = updateDict.get(name)

				if (val !== undefined) {
					this.set(name, val)
				}
			}
		}
		return this
	}

	/**
	 * Returns true if the dict has the specified key.
	 *
	 * ```typescript
	 * if (dict.has('foo')) {
	 *   // Do something
	 * }
	 * ```
	 *
	 * @param name The name of the key.
	 * @returns True if the value exists in the dict.
	 */
	has(name: string): boolean {
		return this.$store.has(name)
	}

	/**
	 * Return true if the dict matches the specified filter or if
	 * the value exists in the dict at least once.
	 *
	 * ```typescript
	 * if (dict.any('site and geoCity == "London"')) {
	 *   ...
	 * }
	 * ```
	 *
	 * @param filter The haystack value, haystack filter or AST node.
	 * @param cx Optional haystack filter evaluation context.
	 * @returns True if the property value exists in the dict.
	 * @throws An error for a invalid haystack filter.
	 */
	any(
		filter: string | Node | OptionalHVal,
		cx?: Partial<EvalContext>
	): boolean {
		if (isHVal(filter) || filter === null) {
			for (const key of this.keys) {
				const val = this.get(key)
				if (valueEquals(val, filter)) {
					return true
				}
			}
			return false
		} else if (
			// Skip the full filter check if we just have a property name.
			typeof filter === 'string' &&
			/^[a-zA-Z0-9_]+$/g.test(filter)
		) {
			return !!this.get(filter)
		} else {
			return new HFilter(filter).eval({
				dict: this,
				namespace: cx?.namespace,
				resolve: cx?.resolve,
			})
		}
	}

	/**
	 * Returns true if the haystack filter matches the value.
	 *
	 * This method is the same as `any`.
	 *
	 * ```typescript
	 * if (dict.matches('site and geoCity == "London"')) {
	 *   // Do something
	 * }
	 * ```
	 *
	 * @param filter The filter to test.
	 * @param cx Optional haystack filter evaluation context.
	 * @returns True if the filter matches ok.
	 */
	matches(filter: string | Node, cx?: Partial<EvalContext>): boolean {
		return this.any(filter, cx)
	}

	/**
	 * Removes a property from the dict.
	 *
	 * ```typescript
	 * // Removes the tag named foo.
	 * dict.remove('foo')
	 * ```
	 *
	 * @param name The property name.
	 */
	remove(name: string): void {
		this.$store.remove(name)
	}

	/**
	 * Clear all entries from the dict.
	 *
	 * ```typescript
	 * // Clear all the entries from the dict.
	 * dict.clear()
	 * ```
	 */
	clear(): void {
		this.$store.clear()
	}

	/**
	 * ```typescript
	 * console.log('Size: ' + dict.length)
	 * ```
	 *
	 * @returns The number of entries in the dict.
	 */
	get length(): number {
		return this.keys.length
	}

	/**
	 * ```typescript
	 * for (let key of dict.keys) {
	 *   console.log(key)
	 * }
	 * ```
	 *
	 * @returns All keys used in the dict.
	 */
	get keys(): string[] {
		return this.$store.getKeys()
	}

	/**
	 * ```typescript
	 * for (let value of dict.values) {
	 *   console.log(value.getKind())
	 * }
	 * ```
	 * @returns All values for the dict.
	 */
	get values(): OptionalHVal[] {
		return this.keys.map(
			(key: string): OptionalHVal => this.$store.get(key) as OptionalHVal
		)
	}

	/**
	 * ```typescript
	 * if (dict.isEmpty()) {
	 *   // There are no entries in the dict.
	 * }
	 * ```
	 *
	 * @returns True when there are no entries in the dict.
	 */
	isEmpty(): boolean {
		return this.$store.getKeys().length === 0
	}

	/**
	 * Returns the underlying object being managed by the store.
	 *
	 * ```typescript
	 * // Gets a JS Object with the keys as strings and the values as HVals.
	 * const obj = dict.toObj()
	 * ```
	 *
	 * @returns A the underlying object.
	 */
	toObj(): HValObj {
		return this.$store.toObj()
	}

	/**
	 * ```typescript
	 * // Convert the dict to an HList of haystack strings.
	 * const hlist = dict.toList<HStr>()
	 * ```
	 *
	 * @returns All the dict's values as a haystack list
	 */
	toList<Value extends HVal>(): HList<Value> {
		return HList.make(this.values as Value[])
	}

	/**
	 * ```typescript
	 * // Convert the dict to an HGrid with one row.
	 * const hgrid = dict.toGrid()
	 * ```
	 * @returns The dict as a grid.
	 */
	toGrid(): HGrid {
		return HGrid.make({ rows: [this] })
	}

	/**
	 * @returns The value as a dict.
	 */
	toDict(): HDict {
		return this
	}

	/**
	 * @returns A JSON reprentation of the object.
	 */
	toJSON(): HaysonDict {
		return this.$store.toJSON()
	}

	/**
	 * @returns A string containing the JSON representation of the object.
	 */
	toJSONString(): string {
		return this.$store.toJSONString()
	}

	/**
	 * @returns A byte buffer that has an encoded JSON string representation of the object.
	 */
	toJSONUint8Array(): Uint8Array {
		return this.$store.toJSONUint8Array()
	}

	/**
	 * @returns A JSON v3 representation of the object.
	 */
	toJSONv3(): JsonV3Dict {
		const obj: Record<string, JsonV3Val> = {}

		for (const key of this.keys) {
			obj[key] = this.get(key)?.toJSONv3() ?? null
		}

		return obj
	}

	/**
	 * Encodes to an encoded zinc value that can be used
	 * in a haystack filter string.
	 *
	 * A dict isn't supported in filter so throw an error.
	 *
	 * @returns The encoded value that can be used in a haystack filter.
	 */
	toFilter(): string {
		throw new Error(NOT_SUPPORTED_IN_FILTER_MSG)
	}

	/**
	 * Encodes to an encoding zinc value.
	 *
	 * @returns The encoded zinc string.
	 */
	toZinc(): string {
		let zinc = '{'

		for (const key of this.keys) {
			const value = this.get(key)

			if (zinc.length > 1) {
				zinc += ' '
			}

			zinc += valueIsKind<HMarker>(value, Kind.Marker)
				? key
				: `${key}:${value?.toZinc(/*nested*/ true) ?? ZINC_NULL}`
		}

		zinc += '}'
		return zinc
	}

	/**
	 * @returns An Axon encoded string.
	 */
	toAxon(): string {
		let zinc = '{'

		for (const key of this.keys) {
			const value = this.get(key)

			if (zinc.length > 1) {
				zinc += ','
			}

			zinc += valueIsKind<HMarker>(value, Kind.Marker)
				? key
				: `${key}:${value?.toAxon() ?? AXON_NULL}`
		}

		zinc += '}'
		return zinc
	}

	/**
	 * Value equality check.
	 *
	 * @param value The value to test.
	 * @returns True if the value is the same.
	 */
	equals(value: unknown): boolean {
		if (!valueIsKind<HDict>(value, Kind.Dict)) {
			return false
		}

		const keys0 = this.$store.getKeys().sort()
		const keys1 = value.$store.getKeys().sort()

		if (keys0.length !== keys1.length) {
			return false
		}

		for (let i = 0; i < keys0.length; ++i) {
			if (keys0[i] !== keys1[i]) {
				return false
			}

			const val0 = this.get(keys0[i])
			const val1 = value.get(keys1[i])

			if (!valueEquals(val0, val1)) {
				return false
			}
		}

		return true
	}

	/**
	 * Compares two values.
	 *
	 * @param value The value to compare against.
	 * @returns The sort order as negative, 0, or positive.
	 */
	compareTo(value: unknown): number {
		if (!valueIsKind<HDict>(value, Kind.Dict)) {
			return -1
		}

		const zinc0 = this.toZinc()
		const zinc1 = value.toZinc()

		if (zinc0 < zinc1) {
			return -1
		}
		if (zinc0 === zinc1) {
			return 0
		}
		return 1
	}

	/**
	 * Iterate over a dict.
	 *
	 * This enables a 'for ... of' loop to be used directly on an iterator.
	 *
	 * @returns A new iterator for a dict.
	 *
	 * ```typescript
	 * // Iterate a dict
	 * for (let row of dict) {
	 *   console.log(row.name)
	 *   console.log(row.value)
	 * }
	 * ```
	 */
	[Symbol.iterator](): Iterator<HValRow> {
		return new DictValueIterator(this)
	}

	/**
	 * @returns The dict as an array like object.
	 */
	asArrayLike(): ArrayLike<HValRow> {
		return this as unknown as ArrayLike<HValRow>
	}

	/**
	 * @returns A string representation of the value.
	 */
	toString(): string {
		let str = '{'

		for (const key of this.keys) {
			const value = this.get(key)

			if (str.length > 1) {
				str += ', '
			}

			str += valueIsKind(value, Kind.Marker)
				? key
				: `${key}: ${String(value)}`
		}

		str += '}'
		return str
	}

	/**
	 * Get the display string for the dict or the given tag. If 'name'
	 * is undefined, then return display text for the entire dict. If 'name'
	 * is non-null then format the tag value. If 'name' is not defined
	 * by this dict then return 'def'.
	 *
	 * ```typescript
	 * // Returns the record's dis tag string value...
	 * myDict.toDis()
	 *
	 * // Returns the record's tag value string value for foo...
	 * myDict.toDis({ name: 'foo' })
	 *
	 * // Returns a localized string based on `disKey`...
	 * myDict.toDis({
	 *   i18n: (pod: string, key: string): string | undefined => pods.get(pod)?.key(key)
	 * })
	 * ```
	 *
	 * @see {@link dictToDis}
	 *
	 * @param options.name Optional tag name.
	 * @param options.def Optional default value.
	 * @param options.i18n Optional function to get localized strings.
	 * @param options.short Optional flag to automatically shorten the display name.
	 * @returns The display string.
	 */
	toDis({
		name,
		def,
		i18n,
		short,
	}: {
		name?: string
		def?: string
		i18n?: LocalizedCallback
		short?: boolean
	} = {}): string {
		return name
			? this.get(name)?.toString() ?? def ?? ''
			: dictToDis(this, def, i18n, short)
	}

	/**
	 * Dump the value to the local console output.
	 *
	 * @param message An optional message to display before the value.
	 * @returns The value instance.
	 */
	inspect(message?: string): this {
		if (message) {
			console.log(String(message))
		}

		const obj: { [prop: string]: string } = {}

		for (const val of this) {
			obj[val.name] = String(val.value)
		}

		console.table(obj)

		return this
	}

	/**
	 * @returns Returns a copy of the dict.
	 */
	newCopy(): HDict {
		const obj: HValObj = {}

		for (const key of this.keys) {
			const val = this.get(key)
			obj[key] = val?.newCopy() ?? null
		}

		return HDict.make(obj)
	}

	/**
	 * Merge multiple dicts into one.
	 *
	 * ```typescript
	 * // The merged dict has all the tags from dict0, dict1 and dict2.
	 * const mergedDict = HDict.merge(dict0, dict1, dict2)
	 * ```
	 *
	 * @param dicts The dicts to merge.
	 * @returns A merged dict.
	 */
	static merge(...dicts: HDict[]): HDict {
		return (
			dicts.reduce((acc: HDict, cur: HDict): HDict => {
				for (const key of cur.keys) {
					const val = cur.get(key)

					if (val !== undefined) {
						acc.set(key, val)
					}
				}

				return acc
			}, HDict.make({})) ?? HDict.make({})
		)
	}

	/**
	 * Create a diff (difference) dict that can be used in an update.
	 *
	 * This will return a new dict with any changed values and
	 * removed tags having an `HRemove` value.
	 *
	 * @param dict The newly updated dict that will be checked for differences.
	 * These differences will be incorporated into the returned dict.
	 * @returns A diff dict.
	 */
	diff(dict: HDict): HDict {
		const diff = new HDict()

		for (const name of HDict.merge(this, dict).keys) {
			const dictVal = dict.get(name)
			const val = this.get(name)

			if (!dictVal) {
				diff.set(name, HRemove.make())
			} else if (!val || !dictVal.equals(val)) {
				diff.set(name, dictVal)
			}
		}

		return diff
	}

	/**
	 * If this dict is for a def then return its
	 * name otherwise return an empty string.
	 *
	 * @returns The def name or an empty string.
	 */
	get defName(): string {
		const val = this.get('def')
		return val ? String(val) : ''
	}

	/**
	 * Analyze this dict and return its implemented defs.
	 *
	 * If a namespace isn't specified then the default environment namespace
	 * will be used.
	 *
	 * @param namespace An optional namespace to perform the reflect from.
	 * @returns An array of dicts.
	 */
	reflect(namespace?: HNamespace): Reflection {
		const ns = namespace ?? HNamespace.defaultNamespace
		return ns.reflect(this)
	}

	/**
	 * Return a reflected array of children prototypes.
	 *
	 * If a namespace isn't specified then the default environment namespace
	 * will be used.
	 *
	 * @param namespace An optional namespace to perform the protos call from.
	 * @returns An array of dicts.
	 */
	protos(namespace?: HNamespace): HDict[] {
		const ns = namespace ?? HNamespace.defaultNamespace
		return ns.protos(this)
	}

	/**
	 * Returns true if this dict is newer than the specified dict.
	 * The `mod` timestamp is used to perform the check.
	 *
	 * @param dict The other dict to compare to this dict.
	 * @return True if this dict is newer.
	 */
	isNewer(dict: HDict): boolean {
		const a = this.get<HDateTime>('mod') ?? HDateTime.make(new Date(0))
		const b = dict.get<HDateTime>('mod') ?? HDateTime.make(new Date(0))

		return a.compareTo(b) > 0
	}
}
