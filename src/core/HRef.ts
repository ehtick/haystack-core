/*
 * Copyright (c) 2020, J2 Innovations. All Rights Reserved
 */

import { Kind } from './Kind'
import {
	HVal,
	CANNOT_CHANGE_READONLY_VALUE,
	valueInspect,
	valueIsKind,
	valueMatches,
	TEXT_ENCODER,
} from './HVal'
import { HaysonRef } from './hayson'
import { HStr } from './HStr'
import { Node } from '../filter/Node'
import { HGrid } from './grid/HGrid'
import { HList } from './list/HList'
import { HDict } from './dict/HDict'
import { EvalContext } from '../filter/EvalContext'
import { JsonV3Ref } from './jsonv3'

/**
 * Haystack ref.
 */
export class HRef implements HVal {
	/**
	 * The ref's value.
	 */
	readonly #value: string

	/**
	 * The ref's display name.
	 */
	readonly #displayName: string
	/**
	 * Constructs a new haystack ref.
	 *
	 * @param value The value.
	 * @param displayName The optional display name.
	 */
	private constructor(
		value: string | HaysonRef | HStr,
		displayName?: string
	) {
		if (valueIsKind<HStr>(value, Kind.Str)) {
			value = value.value
		}

		if (typeof value === 'string') {
			if (value.startsWith('@')) {
				value = value.substring(1, value.length)
			}
			this.#value = value
			this.#displayName = displayName ?? ''
		} else {
			const obj = value as HaysonRef

			this.#value = obj.val
			this.#displayName = obj.dis ?? ''
		}
	}

	/**
	 * Makes a Haystack ref.
	 *
	 * @param value The value or hayson ref.
	 * @param displayName Optional display string for a reference.
	 * @returns A haystack ref.
	 */
	static make(
		value: string | HaysonRef | HRef | HStr,
		displayName?: string
	): HRef {
		if (valueIsKind<HRef>(value, Kind.Ref)) {
			return value
		} else {
			return new HRef(value as string | HaysonRef, displayName)
		}
	}

	/**
	 * @returns The ref value.
	 */
	get value(): string {
		return this.#value
	}

	set value(value: string) {
		throw new Error(CANNOT_CHANGE_READONLY_VALUE)
	}

	/**
	 * @returns The display name value in shorthand.
	 */
	get dis(): string {
		return this.#displayName || this.#value
	}

	set dis(value: string) {
		throw new Error(CANNOT_CHANGE_READONLY_VALUE)
	}

	/**
	 * @returns The display name value.
	 */
	get displayName(): string {
		return this.dis
	}

	set displayName(value: string) {
		throw new Error(CANNOT_CHANGE_READONLY_VALUE)
	}

	/**
	 * @returns The value's kind.
	 */
	getKind(): Kind {
		return Kind.Ref
	}

	/**
	 * Compares the value's kind.
	 *
	 * @param kind The kind to compare against.
	 * @returns True if the kind matches.
	 */
	isKind(kind: Kind): boolean {
		return valueIsKind<HRef>(this, kind)
	}

	/**
	 * Returns true if the haystack filter matches the value.
	 *
	 * @param filter The filter to test.
	 * @param cx Optional haystack filter evaluation context.
	 * @returns True if the filter matches ok.
	 */
	matches(filter: string | Node, cx?: Partial<EvalContext>): boolean {
		return valueMatches(this, filter, cx)
	}

	/**
	 * Dump the value to the local console output.
	 *
	 * @param message An optional message to display before the value.
	 * @returns The value instance.
	 */
	inspect(message?: string): this {
		return valueInspect(this, message)
	}

	/**
	 * Encodes to an encoded zinc value that can be used
	 * in a haystack filter string.
	 *
	 * The encoding for a haystack filter is mostly zinc but contains
	 * some exceptions.
	 *
	 * @returns The encoded value that can be used in a haystack filter.
	 */
	toFilter(): string {
		return this.toZinc(/*excludeDis*/ true)
	}

	/**
	 * Value equality check.
	 *
	 * @param value The value to test.
	 * @returns True if the ref is the same.
	 */
	equals(value: unknown): boolean {
		return valueIsKind<HRef>(value, Kind.Ref) && this.value === value.value
	}

	/**
	 * Compares two values.
	 *
	 * @param value The value to compare against.
	 * @returns The sort order as negative, 0, or positive
	 */
	compareTo(value: unknown): number {
		if (!valueIsKind<HRef>(value, Kind.Ref)) {
			return -1
		}

		if (this.value < value.value) {
			return -1
		}
		if (this.value === value.value) {
			return 0
		}
		return 1
	}

	/**
	 * @returns A string representation of the value.
	 */
	toString(): string {
		return this.toZinc()
	}

	/**
	 * @returns The ref's value.
	 */
	valueOf(): string {
		return this.value
	}

	/**
	 * Encode to zinc encoding.
	 *
	 * @params excludeDis Excludes the display name from the encoding.
	 * @returns The encoded zinc string.
	 */
	toZinc(excludeDis?: boolean): string {
		let zinc = `@${this.value}`

		// If there's a display name then also add it.
		if (!excludeDis && this.#displayName) {
			zinc += ` ${HStr.make(this.#displayName).toZinc()}`
		}

		return zinc
	}

	/**
	 * @returns A JSON reprentation of the object.
	 */
	toJSON(): HaysonRef {
		const obj: HaysonRef = {
			_kind: this.getKind(),
			val: this.value,
		}

		if (this.#displayName) {
			obj.dis = this.#displayName
		}

		return obj
	}

	/**
	 * @returns A string containing the JSON representation of the object.
	 */
	toJSONString(): string {
		return JSON.stringify(this)
	}

	/**
	 * @returns A byte buffer that has an encoded JSON string representation of the object.
	 */
	toJSONUint8Array(): Uint8Array {
		return TEXT_ENCODER.encode(this.toJSONString())
	}

	/**
	 * @returns A JSON v3 representation of the object.
	 */
	toJSONv3(): JsonV3Ref {
		return `r:${this.value}${
			this.#displayName ? ` ${this.#displayName}` : ''
		}`
	}

	/**
	 * @returns An Axon encoded string.
	 */
	toAxon(): string {
		return this.toZinc(/*excludeDis*/ true)
	}

	/**
	 * @returns Returns the value instance.
	 */
	newCopy(): HRef {
		return this
	}

	/**
	 * @returns A ref with no display name.
	 */
	noDis(): HRef {
		return this.#displayName ? HRef.make(this.#value) : this
	}

	/**
	 * @returns The value as a grid.
	 */
	toGrid(): HGrid {
		return HGrid.make(this)
	}

	/**
	 * @returns The value as a list.
	 */
	toList(): HList<HRef> {
		return HList.make([this])
	}

	/**
	 * @returns The value as a dict.
	 */
	toDict(): HDict {
		return HDict.make(this)
	}
}
