/*
 * Copyright (c) 2020, J2 Innovations. All Rights Reserved
 */

import { valueIsKind, ZINC_NULL } from './HVal'
import { Kind } from './Kind'
import { HDict } from './dict/HDict'
import { HGrid } from './grid/HGrid'
import { HMarker } from './HMarker'
import { HStr } from './HStr'

/**
 * The type of item in the trio document.
 */
enum ItemType {
	Dict,
	NewLine,
	Comment,
}

/**
 * An item in the trio document.
 */
interface Item {
	type: ItemType
	dict?: HDict
	text?: string
}

/**
 * Additional options for when writing trio.
 */
export interface TrioWriterOptions {
	/**
	 * True if multi-line strings should be used when writing the trio file.
	 */
	multilineStrings?: boolean
}

const MULTILINE_STRING_INDENTATION = '  '

/**
 * Writes a trio document.
 *
 * ```typescript
 * const trio = new TrioWriter()
 *   .addComment('A comment')
 *   .addNewLine()
 *   .addDict(dict)
 *   .addDict(dict2)
 *   .toTrio()
 * ```
 */
export class TrioWriter {
	/**
	 * The items used to create the trio document.
	 */
	readonly #items: Item[] = []

	/**
	 * Additional options when writing trio.
	 */
	readonly #options?: TrioWriterOptions

	constructor(options?: TrioWriterOptions) {
		this.#options = options
	}

	/**
	 * Add a dict to be written out into the trio document.
	 *
	 * @param item The item to add.
	 * @returns The trio writer instance.
	 */
	addDict(dict: HDict): this {
		this.#items.push({ type: ItemType.Dict, dict })
		return this
	}

	/**
	 * Add all of a grid's rows (dicts) to the trio document.
	 *
	 * @param grid The grid to add.
	 * @returns The trio writer instance.
	 */
	addGrid(grid: HGrid): this {
		for (const dict of grid.getRows()) {
			this.addDict(dict)
		}
		return this
	}

	/**
	 * Add a comment to be written out into the trio document.
	 *
	 * @param comment The comment to add.
	 * @returns The trio writer instance.
	 */
	addComment(comment?: string): this {
		this.#items.push({ type: ItemType.Comment, text: comment || '' })
		return this
	}

	/**
	 * Adds a new line to be written out into the trio document.
	 *
	 * @retursn The trio write instance.
	 */
	addNewLine(): this {
		this.#items.push({ type: ItemType.NewLine })
		return this
	}

	/**
	 * @returns The trio document from the writer's items.
	 */
	toTrio(): string {
		let trio = ''

		for (const item of this.#items) {
			if (trio) {
				trio += '\n'
			}

			switch (item.type) {
				case ItemType.Comment:
					trio += item.text ? `// ${item.text}` : '//'
					break
				case ItemType.Dict:
					trio += TrioWriter.toTrioDict(
						item.dict || HDict.make(),
						this.#options
					)
					trio += '\n---'
					break
			}
		}

		return trio
	}

	/**
	 * @returns The dict as trio encoded.
	 *
	 * @param dict The dict to encode.
	 * @param options Additional options for writing trio.
	 * @returns The trio encoded dict.
	 */
	static toTrioDict(dict: HDict, options?: TrioWriterOptions): string {
		return dict.keys
			.map((name: string): string => {
				const value = dict.get(name)

				if (valueIsKind<HMarker>(value, Kind.Marker)) {
					return name
				} else if (valueIsKind<HGrid>(value, Kind.Grid)) {
					return `${name}:Zinc:\n  ${value
						.toZinc()
						.trim()
						.replace(/\n/g, '\n  ')}`
				} else if (
					options?.multilineStrings &&
					valueIsKind<HStr>(value, Kind.Str)
				) {
					return `${name}: \n${MULTILINE_STRING_INDENTATION}${value.value.replaceAll(
						'\n',
						`\n${MULTILINE_STRING_INDENTATION}`
					)}`
				} else {
					return `${name}: ${value?.toZinc() ?? ZINC_NULL}`
				}
			})
			.join('\n')
	}

	/**
	 * @returns The trio document from the writer's items.
	 */
	toString(): string {
		return this.toTrio()
	}
}
