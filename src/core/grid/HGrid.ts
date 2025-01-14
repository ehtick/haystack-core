/*
 * Copyright (c) 2020, J2 Innovations. All Rights Reserved
 */

/* eslint @typescript-eslint/no-explicit-any: "off" */

import {
	HVal,
	NOT_SUPPORTED_IN_FILTER_MSG,
	valueIsKind,
	valueEquals,
	OptionalHVal,
	ZINC_NULL,
	isHVal,
} from '../HVal'
import { HDict } from '../dict/HDict'
import { HValObj } from '../dict/HValObj'
import { Kind } from '../Kind'
import { HaysonGrid, HaysonDict } from '../hayson'
import { HStr } from '../HStr'
import { HFilter } from '../../filter/HFilter'
import { Node, isNode } from '../../filter/Node'
import { HList } from '../list/HList'
import { makeValue } from '../util'
import { HRef } from '../HRef'
import { EvalContext, EvalContextResolve } from '../../filter/EvalContext'
import { JsonV3Dict, JsonV3Grid, JsonV3Val } from '../jsonv3'
import { GridColumn, isGridColumn } from './GridColumn'
import { GridObjStore } from './GridObjStore'
import { GridJsonStore } from './GridJsonStore'
import {
	DEFAULT_GRID_VERSION,
	GRID_VERSION_NAME,
	GridStore,
	isGridStore,
} from './GridStore'

/**
 * Returns the zinc for the meta data.
 *
 * @param meta The meta data dict.
 * @returns The zinc used for meta data in a grid.
 */
function toMetaZinc(meta: HDict): string {
	const zinc = meta.toZinc()

	// Remove the braces from the dict zinc encoding
	return zinc.substring(1, zinc.length - 1)
}

/**
 * An iterator for dicts.
 */
export class GridDictIterator<DictVal extends HDict>
	implements Iterator<DictVal>
{
	readonly #grid: HGrid
	#index = 0

	constructor(grid: HGrid) {
		this.#grid = grid
	}

	next(): IteratorResult<DictVal> {
		const dict = this.#grid.get(this.#index++)

		return {
			done: !dict,
			value: dict ? (dict as DictVal) : (HDict.make() as DictVal),
		}
	}
}

export interface GridParams<DictVal extends HDict = HDict> {
	meta?: HDict | HaysonDict
	columns?: { name: string; meta?: HDict | HaysonDict }[]
	cols?: { name: string; meta?: HDict | HaysonDict }[]
	rows?: (DictVal | HaysonDict)[]
	version?: string
}

function isHaysonGrid(value: unknown): value is HaysonGrid {
	return (value as HaysonGrid)?._kind === Kind.Grid
}

/**
 * A haystack grid.
 *
 * ```typescript
 * const grid = new HGrid({
 *   columns: [
 *     {
 *       name: 'name'
 *     },
 *     {
 *       name: 'height'
 *     }
 *   ],
 *   // rows
 *   rows: [
 *     new HDict({ name: HStr.make('Mall'),  height: HNum.make(200, 'm') }),
 *     new HDict({ name: HStr.make('House'), height: HNum.make(30, 'm') })
 *   ]
 * })
 *
 * // The same grid can be specified without any rows. The columns will be dynamically
 * // generated based upon the row data...
 * const grid0 = new HGrid({
 *   rows: [
 *     new HDict({ name: HStr.make('Mall'),  height: HNum.make(200, 'm') }),
 *     new HDict({ name: HStr.make('House'), height: HNum.make(30, 'm') })
 *   ]
 * })
 *
 * // The same grid can be created from a Hayson object.
 * // Again columns don't have to be specified unless precise order and meta data is required...
 * const grid1 = new HGrid({
 *   rows: [
 *     { name: 'Mall', height: { _kind: 'number', val: 200, unit: 'm' } },
 *     { name: 'House', height: { _kind: 'number', val: 30, unit: 'm' } },
 *   ]
 * })
 *
 * // Iterate a grid
 * for (let dict of grid) {
 *   console.log(dict)
 * }
 *
 * // Filter a grid
 * const filteredGrid = grid.filter('name == "House"')
 * console.log(filteredGrid)
 *
 * // Test a grid
 * if (grid.has('name == "House"')) {
 *   console.log('Found house!')
 * }
 *
 * // Remove items from a grid
 * grid.remove('name == "Mall"')
 *
 * // Average, sum, max and min...
 * console.log(grid.avgOf('height'))
 * console.log(grid.sumOf('height'))
 * console.log(grid.maxOf('height'))
 * console.log(grid.minOf('height'))
 * ```
 */
export class HGrid<DictVal extends HDict = HDict>
	implements HVal, Iterable<DictVal>
{
	/**
	 * The internal grid storage.
	 */
	private readonly $store: GridStore<DictVal>

	/**
	 * An internal column index cache.
	 *
	 * This is used to increase the performance of column name look ups.
	 */
	private $columnNameCache: Record<string, number> | undefined;

	/**
	 * Numerical index access.
	 */
	[prop: number]: DictVal | undefined

	/**
	 * Constructs a new grid.
	 *
	 * ```typescript
	 * const grid = new HGrid({
	 *   columns: [
	 *     {
	 *       name: 'name'
	 *     },
	 *     {
	 *       name: 'height'
	 *     }
	 *   ],
	 *   // rows
	 *   rows: [
	 *     new HDict({ name: HStr.make('Mall'),  height: HNum.make(200, 'm') }),
	 *     new HDict({ name: HStr.make('House'), height: HNum.make(30, 'm') })
	 *   ]
	 * })
	 *
	 * // The same grid can be specified without any rows. The columns will be dynamically
	 * // generated based upon the row data...
	 * const grid0 = new HGrid({
	 *   rows: [
	 *     new HDict({ name: HStr.make('Mall'),  height: HNum.make(200, 'm') }),
	 *     new HDict({ name: HStr.make('House'), height: HNum.make(30, 'm') })
	 *   ]
	 * })
	 *
	 * // The same grid can be created from a Hayson object.
	 * // Again columns don't have to be specified unless precise order and meta data is required...
	 * const grid1 = new HGrid({
	 *   rows: [
	 *     { name: 'Mall', height: { _kind: 'number', val: 200, unit: 'm' } },
	 *     { name: 'House', height: { _kind: 'number', val: 30, unit: 'm' } },
	 *   ]
	 * })
	 *
	 * // Pass in a haystack value to create a grid...
	 * const grid3 = new HGrid(HNum.make(24)) // Creates a grid with one column called 'val' and one row.
	 *
	 * // Pass in an array of dicts to create a grid...
	 * const grid4 = new HGrid([
	 *   new HDict({ name: HStr.make('Mall'),  height: HNum.make(200, 'm') }),
	 *   new HDict({ name: HStr.make('House'), height: HNum.make(30, 'm') })
	 * ])
	 *
	 * // Pass in an array of Hayson dicts to create a grid...
	 * const grid5 = new HGrid([
	 *   { name: 'Mall', height: { _kind: 'number', val: 200, unit: 'm' } },
	 *   { name: 'House', height: { _kind: 'number', val: 30, unit: 'm' } },
	 * ])
	 * ```
	 *
	 * @param value The values used to create a grid.
	 */
	constructor(
		arg?:
			| GridParams<DictVal>
			| HaysonGrid
			| HVal
			| (HaysonDict | DictVal)[]
			| GridStore<DictVal>
	) {
		if (isHaysonGrid(arg)) {
			this.$store = new GridJsonStore(arg)
		} else if (isGridStore<DictVal>(arg)) {
			this.$store = arg
		} else {
			let meta: HDict | undefined
			let columns: { name: string; meta?: HDict }[] | undefined
			let rows: DictVal[] | undefined
			let version = DEFAULT_GRID_VERSION

			const value = arg as
				| GridParams<DictVal>
				| HVal
				| (HaysonDict | DictVal)[]
				| undefined
				| null

			if (value === undefined) {
				rows = []
			} else if (isHVal(value) || value === null) {
				if (valueIsKind<HGrid<DictVal>>(value, Kind.Grid)) {
					meta = value.meta
					columns = value.getColumns()
					rows = value.getRows()
					version = value.version
				} else if (valueIsKind<HDict>(value, Kind.Dict)) {
					rows = [value] as DictVal[]
				} else {
					rows = [HDict.make({ val: value }) as DictVal]
				}
			} else if (Array.isArray(value)) {
				rows = value.map(
					(dict: HaysonDict | DictVal): DictVal =>
						HDict.make(dict) as DictVal
				) as DictVal[]
			} else {
				if (value.meta) {
					meta = makeValue(value.meta) as HDict

					// Remove the version from the meta. This is used when decoding a Hayson based grid that
					// adds the version number to the grid's meta data. We need to remove the version so
					// comparisons (i.e. `equals`) still work as expected.
					if (meta.has(GRID_VERSION_NAME)) {
						version =
							meta.get<HStr>(GRID_VERSION_NAME)?.value ??
							DEFAULT_GRID_VERSION

						meta.remove(GRID_VERSION_NAME)
					}
				}

				if (value.columns || value.cols) {
					columns =
						(value.columns ?? value.cols)?.map(
							({ name, meta }) => ({
								name,
								meta: meta
									? (makeValue(meta) as HDict)
									: undefined,
							})
						) ?? []
				}

				if (value.rows) {
					rows =
						value.rows?.map((row) => makeValue(row) as DictVal) ??
						[]
				}

				if (value.version) {
					version =
						(value as GridParams<DictVal>).version ||
						DEFAULT_GRID_VERSION
				}
			}

			this.$store = new GridObjStore(
				version,
				meta ?? HDict.make(),
				(columns ?? []).map(
					(column): GridColumn =>
						new GridColumn(column.name, column.meta)
				),
				(rows ?? []) as DictVal[]
			)

			// If there are no columns specified then manually
			// refresh the columns based upon the dicts being added.
			if (!columns?.length) {
				this.refreshColumns()
			}
		}

		return this.makeProxy()
	}

	/**
	 * Implement proxy to make it easy to get and set internal values.
	 */
	private makeProxy(): HGrid<DictVal> {
		const handler = {
			get: function (target: HGrid, prop: string): any {
				const anyTarget = target as any
				return typeof prop === 'string' && /^[0-9]+$/.test(prop)
					? target.get(Number(prop))
					: (anyTarget[prop] as any)
			},
			set(target: HGrid, prop: string, value: any): boolean {
				const anyTarget = target as any
				if (typeof prop === 'string' && /^[0-9]+$/.test(prop)) {
					target.set(Number(prop), value)
				} else {
					anyTarget[prop] = value
				}
				return true
			},
		}
		return new Proxy(this, handler) as HGrid<DictVal>
	}

	private get columnNameCache(): Record<string, number> {
		if (!this.$columnNameCache) {
			this.rebuildColumnCache()
		}
		return this.$columnNameCache as Record<string, number>
	}

	private rebuildColumnCache(): void {
		if (!this.$columnNameCache) {
			this.$columnNameCache = {}
		}

		for (const key of Object.keys(this.$columnNameCache)) {
			delete this.$columnNameCache[key]
		}

		for (let i = 0; i < this.$store.columns.length; ++i) {
			this.$columnNameCache[this.$store.columns[i].name] = i
		}
	}

	/**
	 * Makes a new grid.
	 *
	 * @param value The values used to create a grid.
	 * @returns A grid.
	 */
	static make<DictVal extends HDict = HDict>(
		arg?: GridParams<DictVal> | HaysonGrid | HVal | (HaysonDict | DictVal)[]
	): HGrid<DictVal> {
		return valueIsKind<HGrid<DictVal>>(arg, Kind.Grid)
			? arg
			: new HGrid(arg)
	}

	/**
	 * @returns The grid's version number.
	 */
	get version(): string {
		return this.$store.version
	}

	/**
	 * Sets the grid's version number.
	 */
	set version(version: string) {
		this.$store.version = version
	}

	/**
	 * The grid's meta data.
	 */
	get meta(): HDict {
		return this.$store.meta
	}

	/**
	 * @returns The value's kind.
	 */
	getKind(): Kind {
		return Kind.Grid
	}

	/**
	 * Compares the value's kind.
	 *
	 * @param kind The kind to compare against.
	 * @returns True if the kind matches.
	 */
	isKind(kind: Kind): boolean {
		return valueIsKind<HGrid>(this, kind)
	}

	/**
	 * @returns A JSON reprentation of the object.
	 */
	toJSON(): HaysonGrid {
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
	toJSONv3(): JsonV3Grid {
		return {
			meta: {
				[GRID_VERSION_NAME]: this.version,
				...this.meta.toJSONv3(),
			},
			cols: this.$store.columns.map(
				(
					column: GridColumn
				): {
					name: string
					[prop: string]: JsonV3Val
				} => ({
					name: column.name,
					...column.meta.toJSONv3(),
				})
			),
			rows: this.getRows().map(
				(row: DictVal): JsonV3Dict => row.toJSONv3()
			),
		}
	}

	/**
	 * Encodes to an encoded zinc value that can be used
	 * in a haystack filter string.
	 *
	 * A grid isn't supported in filter so throw an error.
	 *
	 * @returns The encoded value that can be used in a haystack filter.
	 */
	toFilter(): string {
		throw new Error(NOT_SUPPORTED_IN_FILTER_MSG)
	}

	/**
	 * Encodes to an encoding zinc value.
	 *
	 * @param nested An optional flag used to indiciate whether the
	 * value being encoded is nested.
	 * @returns The encoded zinc string.
	 */
	toZinc(nested?: boolean): string {
		let zinc = nested ? '<<\n' : ''

		// Header and version
		zinc += `${GRID_VERSION_NAME}:${HStr.make(this.version).toZinc()}`

		// Meta
		const metaZinc = toMetaZinc(this.meta)
		if (metaZinc) {
			zinc += ` ${metaZinc}`
		}
		zinc += '\n'

		const rows = this.getRows()

		// Columns
		if (!rows.length && !this.$store.columns.length) {
			zinc += 'empty\n'
		} else {
			zinc +=
				this.$store.columns
					.map((col: GridColumn): string => {
						let colZinc = col.name

						const metaZinc = toMetaZinc(col.meta)
						if (metaZinc) {
							colZinc += ` ${metaZinc}`
						}
						return colZinc
					})
					.join(',') + '\n'
		}

		// Rows
		zinc +=
			rows
				.map((row: DictVal): string =>
					this.$store.columns
						.map((col, index: number): string => {
							const val = row.get(col.name)
							return (
								(index > 0 ? ',' : '') +
								(val === undefined
									? ''
									: val?.toZinc(/*nested*/ true) ?? ZINC_NULL)
							)
						})
						.join('')
				)
				.join('\n') + '\n'

		if (nested) {
			// Footer
			zinc += '>>'
		}

		return zinc
	}

	/**
	 * @returns An Axon encoded string.
	 */
	toAxon(): string {
		let axon = `${HList.make(this.getRows()).toAxon()}.toGrid`

		if (!this.meta.isEmpty()) {
			axon += `.addMeta(${this.meta.toAxon()})`
		}

		return axon
	}

	/**
	 * Grid equality check.
	 *
	 * @param value The value to test.
	 * @returns True if the value is the same.
	 */
	equals(value: unknown): boolean {
		if (!valueIsKind<HGrid>(value, Kind.Grid)) {
			return false
		}

		if (this.version !== value.version) {
			return false
		}

		if (!this.meta.equals(value.meta)) {
			return false
		}

		if (this.$store.columns.length !== value.$store.columns.length) {
			return false
		}

		for (let i = 0; i < this.$store.columns.length; ++i) {
			if (!this.$store.columns[i].equals(value.$store.columns[i])) {
				return false
			}
		}

		if (this.length !== value.length) {
			return false
		}

		for (let i = 0; i < this.length; ++i) {
			const row0 = this.get(i)
			const row1 = value.get(i)

			if (!row0?.equals(row1)) {
				return false
			}
		}

		return true
	}

	/**
	 * Compares two grids.
	 *
	 * @param value The value to compare against.
	 * @returns The sort order as negative, 0, or positive.
	 */
	compareTo(value: unknown): number {
		if (!valueIsKind<HGrid>(value, Kind.Grid)) {
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
	 * Return all the rows of the grid.
	 *
	 * ```typescript
	 * const anArrayOfDicts = grid.getRows()
	 * ```
	 *
	 * @returns All rows in the grid.
	 */
	getRows(): DictVal[] {
		return this.$store.rows
	}

	/**
	 * Return a row or undefined if it can't find it via its
	 * row number.
	 *
	 * ```typescript
	 * // Get a dict at a given index or returned undefined if it can't be found.
	 * const dict = grid.get(0)
	 * if (dict) {
	 *   // Do something
	 * }
	 * ```
	 *
	 * @param index The index number of the row.
	 * @returns The dict or undefined if it does not exist.
	 */
	get(index: number): DictVal | undefined {
		this.checkRowIndexNum(index)
		return this.$store.rows[index]
	}

	/**
	 * Return the first row in the grid or undefined if it can't be found.
	 *
	 * ```typescript
	 * const dict = grid.first
	 * if (dict) {
	 *   // Do something
	 * }
	 * ```
	 *
	 * @returns The dict or undefined if it does not exist.
	 */
	get first(): DictVal | undefined {
		return this.get(0)
	}

	/**
	 * Return the last row in the grid or undefined if it can't be found.
	 *
	 * ```typescript
	 * const dict = grid.last
	 * if (dict) {
	 *   // Do something
	 * }
	 * ```
	 *
	 * @returns The dict or undefined if it does not exist.
	 */
	get last(): DictVal | undefined {
		return this.get(Math.max(0, this.length - 1))
	}

	/**
	 * Remove the row from the grid via its index number of a haystack filter.
	 *
	 * ```typescript
	 * // Remove a row via its index
	 * grid.remove(0)
	 *
	 * // Remove multiple rows via a Haystack Filter
	 * grid.remove('foo == "baa"')
	 * ```
	 *
	 * @param filter A haystack filter, index number or AST node.
	 * @param cx Optional haystack filter evaluation context.
	 * @returns The rows that were removed. If no rows were removed then the is empty.
	 */
	remove(
		filter: number | string | Node,
		cx?: Partial<EvalContext>
	): DictVal[] {
		let removed: DictVal[]

		if (typeof filter === 'string' || isNode(filter)) {
			removed = []
			const toRemove: number[] = []

			this.runFilter(
				filter as string,
				(match: boolean, row: DictVal, index: number): boolean => {
					if (match) {
						toRemove.push(index)
						removed.push(row)
					}

					// Keep iterating.
					return true
				},
				cx
			)

			for (let i = toRemove.length - 1; i >= 0; --i) {
				this.getRows().splice(toRemove[i], 1)
			}
		} else {
			const index = filter as number

			this.checkRowIndexNum(index)

			removed = this.getRows().splice(index, 1)
		}

		return removed
	}

	/**
	 * Filter the grid with the haystack filter and return a new grid with the results.
	 *
	 * ```typescript
	 * // Filter a grid with a haystack filter
	 * const newGridWithFoo = grid.filter('foo')
	 *
	 * // Filter a grid with a function callback
	 * const newGridWithFooAgain = grid.filter((row: HDict): boolean => row.has('foo'))
	 * ```
	 *
	 * @param filter The haystack filter, AST node or filter function callback.
	 * @param cx Optional haystack filter evaluation context.
	 * @returns A new filtered grid.
	 */
	filter(
		filter: string | Node | ((row: DictVal, index: number) => boolean),
		cx?: Partial<EvalContext>
	): HGrid<DictVal> {
		const grid = HGrid.make<DictVal>({
			meta: this.meta,
			rows: [],
			version: this.version,
		})

		if (typeof filter === 'function') {
			for (const row of this.getRows().filter(filter)) {
				grid.add(row)
			}
		} else {
			this.runFilter(
				filter,
				(match: boolean, row: DictVal): boolean => {
					if (match) {
						grid.add(row)
					}

					// Keep iterating.
					return true
				},
				cx
			)
		}

		this.syncColumnMeta(grid)
		return grid
	}

	/**
	 * Synchronize column meta information from this grid to the specified grid.
	 *
	 * @param grid The grid to synchronize data to.
	 */
	private syncColumnMeta(grid: HGrid): void {
		for (const col of this.getColumns()) {
			const newCol = grid.getColumn(col.name)

			if (newCol && !newCol.meta.equals(col.meta)) {
				newCol.meta.clear()
				newCol.meta.update(col.meta)
			}
		}
	}

	/**
	 * Filters an individual column in a grid.
	 *
	 * For example, if a particular column in a grid holds a list.
	 * The inner filter can be run against all of the list values
	 * held in that column.
	 *
	 * The filter can be run against a list, dict or grid.
	 *
	 * ```typescript
	 * const grid = HGrid.make({
	 *   rows: [
	 *     { list: [ 'foo', 'boo', 'goo' ] },
	 *     { list: [ 'foo', 'boo1', 'goo1' ] },
	 *     { list: [ 'doo', 'boo1', 'goo1' ] },
	 *   ]
	 * })
	 *
	 * // Returns a grid with only the first two rows.
	 * const newGrid = grid.filterBy('list', 'item == "foo"')
	 * ```
	 *
	 * @param name The name of the column that holds the list values.
	 * @param innerFilter The haystack filter to run against the list.
	 * @param cx Optional haystack filter evaluation context.
	 * @returns A filtered grid.
	 */
	filterBy(
		name: string,
		innerFilter: string | Node,
		cx?: Partial<EvalContext>
	): HGrid<DictVal> {
		// Parse the AST node so we don't need to reparse it each time.
		const node =
			typeof innerFilter === 'string'
				? HFilter.parse(innerFilter)
				: innerFilter

		cx = {
			namespace: cx?.namespace,
			resolve: this.makeResolveFunc(),
		}

		return this.filter((row: DictVal): boolean => {
			const val = row.get(name)

			if (
				valueIsKind<HList>(val, Kind.List) ||
				valueIsKind<HGrid>(val, Kind.Grid)
			) {
				return val.any(node, cx)
			} else if (valueIsKind<HDict>(val, Kind.Dict)) {
				return val.matches(node, cx)
			} else {
				return false
			}
		})
	}

	/**
	 * Provide a grid with unique values in the specified columns.
	 *
	 * ```typescript
	 * const grid = HGrid.make({
	 *   rows: [
	 * 	   { id: 1, name: 'Jason' },
	 * 	   { id: 2, name: 'Gareth' },
	 * 	   { id: 3, name: 'Gareth' },
	 *   ]
	 * })
	 *
	 * // Returns a new grid with rows 1 and 2.
	 * const uniqueGrid = grid.unique('name')
	 * ```
	 *
	 * @param names The column names.
	 * @returns The filtered grid instance.
	 */
	uniqueBy(names: string | string[]): HGrid<DictVal> {
		const uniqueNames = Array.isArray(names) ? names : [names]

		const grid = HGrid.make<DictVal>({
			meta: this.meta,
			rows: [],
			version: this.version,
		})

		let rows = this.getRows()

		// First filter out any rows that don't have any data.
		rows = rows.filter((dict: DictVal): boolean => {
			for (const name of uniqueNames) {
				if (!dict.has(name)) {
					return false
				}
			}

			return true
		})

		// Filter unique data.
		rows = rows.filter((dict: DictVal, index: number): boolean => {
			// For each row identify if there are other rows that have the same
			// value but a different index.
			// The test passes if there are no other rows with the same values.

			for (let i = 0; i < index; ++i) {
				let duplicates = 0

				for (const name of uniqueNames) {
					const val0 = dict.get(name)
					const val1 = rows[i].get(name)

					if (valueEquals(val0, val1)) {
						++duplicates
					} else {
						break
					}
				}

				// If all the rows are duplicates then exclude this result.
				if (duplicates === uniqueNames.length) {
					return false
				}
			}

			return true
		})

		// Add all the newly filtered rows to the grid.
		if (rows.length) {
			grid.add(rows as DictVal[])
			this.syncColumnMeta(grid)
		}

		return grid
	}

	/**
	 * Return true if the filter matches at least one row.
	 *
	 * ```typescript
	 * if (grid.any('site')) {
	 *   // The grid has some sites.
	 * }
	 * ```
	 *
	 * @param filter The haystack filter or AST node.
	 * @param cx Optional haystack filter evaluation context.
	 * @returns true if there's at least one match
	 */
	any(filter: string | Node, cx?: Partial<EvalContext>): boolean {
		let result = false
		this.runFilter(
			filter,
			(match: boolean): boolean => {
				if (match) {
					result = true

					// Stop iterating since we have one match.
					return false
				}

				// Keep iterating.
				return true
			},
			cx
		)
		return result
	}

	/**
	 * Return the first row dict that matches the filter or undefined if nothing is found.
	 *
	 * ```typescript
	 * const dict = grid.find('site'))
	 * ```
	 *
	 * @param filter The haystack filter or AST node.
	 * @param cx Optional haystack filter evaluation context.
	 * @returns The first row dict that matches the filter.
	 */
	find(
		filter: string | Node,
		cx?: Partial<EvalContext>
	): DictVal | undefined {
		let result: DictVal | undefined

		this.runFilter(
			filter,
			(match: boolean, row: DictVal): boolean => {
				if (match) {
					result = row

					// Stop iterating since we have one match.
					return false
				}

				// Keep iterating.
				return true
			},
			cx
		)
		return result
	}

	/**
	 * Returns true if the haystack filter matches the value.
	 *
	 * This is the same as the `any` method.
	 *
	 * ```typescript
	 * if (grid.matches('site')) {
	 *   // The grid has some sites.
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
	 * Return true if the filter matches at least one cell
	 * in a particular column in the grid.
	 *
	 * This filter runs on the data held in the particular column.
	 *
	 * ```typescript
	 * const grid = HGrid.make({
	 *   rows: [
	 *     { list: [ 'foo', 'boo', 'goo' ] },
	 *     { list: [ 'foo', 'boo1', 'goo1' ] },
	 *     { list: [ 'doo', 'boo1', 'goo1' ] },
	 *   ]
	 * })
	 *
	 * if (grid.anyBy('list', 'item === "foo"')) {
	 *   // One or more of the items in the list contains 'foo'
	 * }
	 * ```
	 *
	 * @param filter The haystack filter or AST node.
	 * @param cx Optional haystack filter evaluation context.
	 * @returns true if there's at least one match
	 */
	anyBy(
		name: string,
		innerFilter: string | Node,
		cx?: Partial<EvalContext>
	): boolean {
		// Parse the AST node so we don't need to reparse it each time.
		const node =
			typeof innerFilter === 'string'
				? HFilter.parse(innerFilter)
				: innerFilter

		cx = {
			namespace: cx?.namespace,
			resolve: this.makeResolveFunc(),
		}

		for (const row of this) {
			const val = row.get(name)

			if (
				valueIsKind<HList>(val, Kind.List) ||
				valueIsKind<HGrid>(val, Kind.Grid)
			) {
				if (val.any(node, cx)) {
					return true
				}
			} else if (valueIsKind<HDict>(val, Kind.Dict)) {
				if (val.matches(node, cx)) {
					return true
				}
			}
		}

		return false
	}

	/**
	 * Return true if the filter matches at least one row.
	 *
	 * ```typescript
	 * const grid = HGrid.make({
	 *   rows: [
	 *     { name: 'Fred' },
	 *     { name: 'Fred' },
	 *     { name: 'Fred' },
	 *   ]
	 * })
	 *
	 * if (grid.all('name == "Fred")) {
	 *   // All rows in the grid have the name Fred.
	 * }
	 * ```
	 *
	 * @param filter The haystack filter or AST node.
	 * @param cx Optional haystack filter evaluation context.
	 * @returns true if there's at least one match
	 */
	all(filter: string | Node, cx?: Partial<EvalContext>): boolean {
		if (this.isEmpty()) {
			return false
		}

		let result = true
		this.runFilter(
			filter,
			(match: boolean): boolean => {
				if (!match) {
					result = false

					// Stop iterating because the test has failed.
					return false
				}

				// Keep iterating.
				return true
			},
			cx
		)

		return result
	}

	/**
	 * Return true if the filter matches all the values
	 * in a particular column in the grid.
	 *
	 * This filter runs on the data held in the particular column.
	 *
	 * ```typescript
	 * const grid = HGrid.make({
	 *   rows: [
	 *     { list: [ 'foo', 'foo', 'foo' ] },
	 *     { list: [ 'foo', 'foo', 'foo' ] },
	 *     { list: [ 'foo', 'foo', 'foo' ] },
	 *   ]
	 * })
	 *
	 * if (grid.allBy('list', 'item == "foo"')) {
	 *   // True if all the lists contain all foos.
	 * }
	 * ```
	 *
	 * @param filter The haystack filter or AST node.
	 * @param cx Optional haystack filter evaluation context.
	 * @returns true if there's at least one match
	 */
	allBy(
		name: string,
		innerFilter: string | Node,
		cx?: Partial<EvalContext>
	): boolean {
		// Parse the AST node so we don't need to reparse it each time.
		const node =
			typeof innerFilter === 'string'
				? HFilter.parse(innerFilter)
				: innerFilter

		if (this.isEmpty()) {
			return false
		}

		cx = {
			namespace: cx?.namespace,
			resolve: this.makeResolveFunc(),
		}

		for (const row of this) {
			const val = row.get(name)

			if (
				valueIsKind<HList>(val, Kind.List) ||
				valueIsKind<HGrid>(val, Kind.Grid)
			) {
				if (!val.all(node, cx)) {
					return false
				}
			} else if (valueIsKind<HDict>(val, Kind.Dict)) {
				if (val.matches(node, cx)) {
					return false
				}
			} else {
				return false
			}
		}

		return true
	}

	/**
	 * Run the filter. For each match invoke the callback function.
	 *
	 * The callback takes a match flag, a row and an index argument. If false is returned
	 * the filter stops running.
	 *
	 * @param filter The haystack filter to run or an AST node.
	 * @param callback The callback invoked for each match.
	 * @param cx Optional haystack filter evaluation context.
	 */
	private runFilter(
		filter: string | Node,
		callback: (match: boolean, row: DictVal, index: number) => boolean,
		cx: Partial<EvalContext> | undefined
	): void {
		const hfilter = new HFilter(filter)

		const context = {
			dict: HDict.make(),
			resolve: this.makeResolveFunc(),
			namespace: cx?.namespace,
		}

		// Use iterator so we don't have to drain all the rows.
		let i = 0
		for (const dict of this) {
			context.dict = dict

			// Run the filter against the row.
			// If the callback returns false then stop the filtering.
			if (!callback(hfilter.eval(context), dict, i++)) {
				break
			}
		}
	}

	/**
	 * Return a function that when called will search for a
	 * dict (record) via its id.
	 *
	 * The method lazily optimizes the request by indexing the grid's id.
	 *
	 * @returns  The evaluation context resolve method for a grid.
	 */
	private makeResolveFunc(): EvalContextResolve {
		let ids: Map<string, HDict>
		return (ref: HRef): HDict | undefined => {
			// Lazily build up a map of id refs to records in this grid.
			if (!ids) {
				ids = new Map()

				if (this.hasColumn('id')) {
					for (const row of this) {
						const id = row.get('id')

						if (valueIsKind<HRef>(id, Kind.Ref)) {
							ids.set(id.value, row)
						}
					}
				}
			}

			return ids.get(ref.value)
		}
	}

	/**
	 * A mapping function that maps from an array of dicts into something else.
	 *
	 * ```typescript
	 * // Map each row to a div using React...
	 * grid.map((dict: HDict) => <div>{dict.toZinc()}</div>>)
	 * ```
	 *
	 * @param callback A mapping callback that takes a row dict, an index number
	 * and returns a new value.
	 */
	map<U>(callback: (row: DictVal, index: number) => U): U[] {
		return this.getRows().map(callback)
	}

	/**
	 * Reduce the rows in a grid.
	 *
	 * ```typescript
	 * // Reduce the grid down to one row...
	 * grid = HGrid.make({
	 *   rows: [
	 *     { a: 1, b: 2 },
	 *     { a: 3, b: 4 },
	 *   ],
	 * })
	 *
	 * grid.reduce((prev, cur): HGrid => {
	 *   const dict = prev.get(0)
	 *
	 *   if (dict) {
	 *     dict.set('a', Number(cur.get<HNum>('a')?.value) + Number(dict.get<HNum>('a')?.value))
	 *     dict.set('b', Number(cur.get<HNum>('b')?.value) + Number(dict.get<HNum>('b')?.value))
	 *   }
	 *
	 *   return prev
	 *}, HGrid.make({ rows: [{ a: 0, b: 0 }] }))
	 * ```
	 *
	 * @param callback The reducer callback. This method will be called with the previous and
	 * current rows (dicts) as well as the index number.
	 * @param initialValue Optional initial value for the reduce.
	 */
	reduce<U = DictVal>(
		callback: (
			prev: U,
			current: DictVal,
			currentIndex: number,
			array: DictVal[]
		) => U,
		initialValue?: U
	): U {
		return initialValue === undefined
			? (this.getRows().reduce(callback as any) as any)
			: this.getRows().reduce(callback, initialValue)
	}

	/**
	 * ```typescript
	 * // The number of rows in a grid.
	 * console.log(grid.length)
	 * ```
	 *
	 * @returns The total number of rows.
	 */
	get length(): number {
		return this.$store.rows.length
	}

	/**
	 * Set the values or dict for an individual row.
	 *
	 * ```typescript
	 * // Set a row in a grid.
	 * grid.set(0, new HDict({ foo: HStr.make('foobar') }))
	 *
	 * // Set a row via Hayson.
	 * grid.set(0, { foo: 'foobar' })
	 * ```
	 *
	 * @param index The index number of the row.
	 * @param values The dict or Hayson Dict.
	 * @returns The grid instance.
	 * @throws An error if the index is invalid or the number of rows incorrect.
	 */
	set(index: number, values: DictVal | HaysonDict): this {
		const dict = makeValue(values) as DictVal

		if (!dict.isKind(Kind.Dict)) {
			throw new Error('Invalid value')
		}

		this.checkRowIndexNum(index)

		this.addMissingColumns(dict)

		this.getRows()[index] = dict
		return this
	}

	/**
	 * Refreshes a grid's columns based upon the rows in the grid.
	 */
	refreshColumns(): void {
		for (const row of this.getRows()) {
			this.addMissingColumns(row)
		}
	}

	/**
	 * Adds any missing columns for the dict.
	 *
	 * @param dict The dict to check.
	 */
	private addMissingColumns(dict: DictVal): void {
		// Add any missing columns.
		for (const key of dict.keys) {
			if (!this.hasColumn(key)) {
				this.addColumn(key)
			}
		}
	}

	/**
	 * Add a single or multiple rows using dicts.
	 *
	 * This method can be called in different ways to add multiple rows at a time.
	 *
	 * ```typescript
	 * // Add a single dict.
	 * grid.add(new HDict({ foo: HStr.make('bar') }))
	 *
	 * // Add multiple dicts.
	 * grid.add(new HDict({ foo: HStr.make('bar') }), new HDict({ foo: HStr.make('bar') }))
	 *
	 * // Add multiple dicts using an array...
	 * grid.add([new HDict({ foo: HStr.make('bar') }), new HDict({ foo: HStr.make('bar') })])
	 *
	 * // Same but using Hayson...
	 * grid.add({ foo: 'bar' }))
	 * grid.add({ foo: 'bar' }), { foo: 'bar' })
	 * grid.add([{ foo: 'bar' }), { foo: 'bar' }])
	 * ```
	 * @param rows The rows to add.
	 * @returns The grid instance.
	 * @throws If the values being added are not dicts.
	 */
	add(...rows: (DictVal[] | HaysonDict[] | DictVal | HaysonDict)[]): this {
		const toAdd = HGrid.toDicts(rows)

		if (!toAdd.length) {
			throw new Error('No dicts to add to grid')
		}

		for (let row of toAdd) {
			row = makeValue(row) as DictVal

			if (!valueIsKind<HDict>(row, Kind.Dict)) {
				throw new Error('Row is not a dict')
			}

			this.addMissingColumns(row)

			this.getRows().push(row)
		}

		return this
	}

	/**
	 * Insert rows as dicts at the specified index.
	 *
	 * ```typescript
	 * // Insert a single dict.
	 * grid.insert(1, new HDict({ foo: HStr.make('bar') }))
	 *
	 * // Insert multiple dicts.
	 * grid.insert(1, new HDict({ foo: HStr.make('bar') }), new HDict({ foo: HStr.make('bar') }))
	 *
	 * // Insert multiple dicts using an array...
	 * grid.insert(1, [new HDict({ foo: HStr.make('bar') }), new HDict({ foo: HStr.make('bar') })])
	 *
	 * // Same but using Hayson...
	 * grid.insert(1, { foo: 'bar' }))
	 * grid.insert(1, { foo: 'bar' }), { foo: 'bar' })
	 * grid.insert(1, [{ foo: 'bar' }), { foo: 'bar' }])
	 * ```
	 *
	 * @param index The index number to insert the rows at.
	 * @param rows The rows to insert.
	 * @returns The grid instance.
	 * @throws An error if the index is invalid or the rows are not dicts.
	 */
	insert(
		index: number,
		...rows: (DictVal[] | HaysonDict[] | DictVal | HaysonDict)[]
	): this {
		const toInsert = HGrid.toDicts(rows)

		if (!toInsert.length) {
			throw new Error('No dicts to insert into grid')
		}

		if (index < 0) {
			throw new Error('Index cannot be less than zero')
		}

		if (index > this.length) {
			throw new Error('Index not in range')
		}

		for (let row of toInsert) {
			row = makeValue(row) as DictVal

			if (!valueIsKind<HDict>(row, Kind.Dict)) {
				throw new Error('Row is not a dict')
			}

			this.addMissingColumns(row)

			// Insert into the array
			this.getRows().splice(index++, 0, row)
		}

		return this
	}

	/**
	 * Sort the grid in ascending order via a column name. This also
	 * supports sorting via multiple column names.
	 *
	 * Precedence is given to the first columns in the table.
	 *
	 * ```typescript
	 * // Sorts the grid in ascending order by 'foo'
	 * grid.sortBy('foo')
	 *
	 * // Sorts the grid in ascending order by 'foo' and then by 'boo'
	 * grid.sortBy(['foo', 'boo'])
	 * ```
	 *
	 * @param names The name of the column to sort by.
	 * @returns The grid instance.
	 */
	sortBy(names: string | string[]): this {
		const sortNames = Array.isArray(names) ? names : [names]

		if (sortNames.length) {
			this.getRows().sort((first: DictVal, second: DictVal): number => {
				for (const name of sortNames) {
					const firstVal = first.get(name)
					const secondVal = second.get(name)

					if (firstVal && secondVal) {
						const res = firstVal.compareTo(secondVal)

						if (res !== 0) {
							return res
						}
					}
				}

				return -1
			})
		}

		return this
	}

	/**
	 * Reverses the order of all the rows in the grid.
	 *
	 * ```typescript
	 * // Sort the grid in descending order by foo
	 * grid.sortBy('foo').reverse()
	 * ```
	 */
	reverse(): void {
		this.getRows().reverse()
	}

	/**
	 * Returns a flattened array of dicts.
	 *
	 * @param rows The rows to flatten into an array of dicts.
	 * @returns An array of dicts.
	 */
	private static toDicts<DictVal extends HDict>(
		rows: (DictVal[] | HaysonDict[] | DictVal | HaysonDict)[]
	): DictVal[] {
		const dicts: DictVal[] = []

		for (const row of rows) {
			if (Array.isArray(row)) {
				for (const innerRow of row) {
					dicts.push(makeValue(innerRow) as DictVal)
				}
			} else {
				dicts.push(makeValue(row) as DictVal)
			}
		}

		return dicts
	}

	/**
	 * ```typescript
	 * // Create a grid with no rows (still retains column and meta).
	 * grid.clear()
	 * ```
	 *
	 * Clear all the rows from the grid.
	 */
	clear(): void {
		this.getRows().splice(0, this.length)
	}

	/**
	 * Return an array of column information.
	 *
	 * ```typescript
	 * // Return an array of column objects.
	 * const cols = grid.getColumns()
	 * ```
	 *
	 * @returns A copy of the grid's columns.
	 */
	getColumns(): GridColumn[] {
		return [...this.$store.columns]
	}

	/**
	 * Return the column names (not display names).
	 *
	 * @returns The column names.
	 */
	getColumnNames(): string[] {
		return this.$store.columns.map((col: GridColumn): string => col.name)
	}

	/**
	 * Add a column and return its new instance.
	 *
	 * If the column is already available then update it.
	 *
	 * ```typescript
	 * grid.addColumn('Address', new HDict({ length: 30 }))
	 * ```
	 *
	 * @param name The name of the column.
	 * @param meta The column's meta data.
	 * @returns The new column or the one already found.
	 */
	addColumn(name: string, meta?: HDict): GridColumn {
		const index = this.columnNameCache[name]

		// If the column already exists then just update it.
		if (typeof index === 'number') {
			return this.setColumn(index, name, meta || HDict.make())
		} else {
			const column = new GridColumn(name, meta || HDict.make())
			this.$store.columns.push(column)
			this.rebuildColumnCache()
			return column
		}
	}

	/**
	 * Does the grid have the specified column?
	 *
	 * ```typescript
	 * if (grid.hasColumn('Address)) {
	 *   // The grid has a column called address.
	 * }
	 * ```
	 *
	 * @param name The name of the column.
	 * @returns True if the grid has the column.
	 */
	hasColumn(name: string): boolean {
		return this.columnNameCache[name] !== undefined
	}

	/**
	 * Set the column at the specified index number.
	 *
	 * ```typescript
	 * // Set the column at the specified index with the new name and length.
	 * grid.setColumn(3, 'Address', new HDict({ length: 30 }))
	 * ```
	 *
	 * @param index The zero based index number of the column.
	 * @param name The name of the column.
	 * @param meta Optional column's meta data.
	 * @returns The updated column.
	 * @throws An error if index does not exist in the columns.
	 */
	setColumn(index: number, name: string, meta?: HDict): GridColumn {
		if (!this.$store.columns[index]) {
			throw new Error('Cannot set an invalid column')
		}

		const column = new GridColumn(name, meta || HDict.make())

		this.$store.columns[index] = column
		this.columnNameCache[column.name] = index

		return column
	}

	/**
	 * Returns a grid column via its name or index number. If it can't be found
	 * then return undefined.
	 *
	 * ```typescript
	 * // Get the column at the specified index or return undefined
	 * const col = grid.getColumn('Address')
	 * if (col) {
	 *   // Do something
	 * }
	 *
	 * // Alternatively use the column index to get the column
	 * const col1 = grid.getColumn(3)
	 * if (col1) {
	 *   // Do something
	 * }
	 * ```
	 *
	 * @param index The column index number or name.
	 * @returns The column or undefined if not found.
	 */
	getColumn(index: number | string): GridColumn | undefined {
		let column: GridColumn | undefined
		if (typeof index === 'number') {
			column = this.$store.columns[index as number]
		} else if (typeof index === 'string') {
			const i = this.columnNameCache[index]
			if (i !== undefined) {
				column = this.$store.columns[i]
			}
		} else {
			throw new Error('Invalid input')
		}
		return column
	}

	/**
	 * Returns the number of columns.
	 *
	 * ```typescript
	 * console.log('The table has this many columns: ' + grid.getColumnsLength())
	 * ```
	 *
	 * @returns The number of columns.
	 */
	getColumnsLength(): number {
		return this.$store.columns.length
	}

	/**
	 * Reorder the columns with the specified new order of names.
	 *
	 * ```typescript
	 * const grid = HGrid.make({
	 *   columns: [
	 *     { name: 'b' },
	 *     { name: 'c' },
	 *     { name: 'a' },
	 *   ]
	 * })
	 *
	 * // Reorder the columns to be a, b and then c.
	 * grid.reorderColumns([ 'a', 'b', 'c' ])
	 * ```
	 *
	 * @param names The new order of column names to use.
	 */
	reorderColumns(names: string | string[]): void {
		const colNames = Array.isArray(names) ? names : [names]

		this.$store.columns = this.$store.columns.sort(
			(first, second): number => {
				let firstIndex = 0
				let secondIndex = 0
				for (let i = 0; i < colNames.length; ++i) {
					if (colNames[i] === first.name) {
						firstIndex = i
					}
					if (colNames[i] === second.name) {
						secondIndex = i
					}
				}

				return firstIndex - secondIndex
			}
		)

		this.rebuildColumnCache()
	}

	/**
	 * Return a haystack list for all the values in
	 * the specified column.
	 *
	 * If the column can't be found then an empty list is returned.
	 *
	 * ```typescript
	 * const grid = HGrid.make({
	 *   rows: [
	 *     { name: 'Gareth', id: 1 },
	 *     { name: 'Jason', id: 2 },
	 *     { name: 'Radu', id: 3 },
	 *   ]
	 * })
	 *
	 * // Returns an HList<HStr> of the names (Gareth, Jason and Radu).
	 * const listOfNames = grid.listBy<HStr>('name')
	 * ```
	 *
	 * @param column The column name, column index or instance to
	 * create the list from.
	 */
	listBy<Value extends OptionalHVal>(
		column: string | number | GridColumn
	): HList<Value> {
		let name: string | undefined

		if (isGridColumn(column)) {
			for (let i = 0; i < this.$store.columns.length; ++i) {
				if (column.name === this.$store.columns[i].name) {
					name = column.name
					break
				}
			}
		} else {
			switch (typeof column) {
				case 'string':
					name = column
					break
				case 'number':
					const col = this.$store.columns[column]
					if (col) {
						name = col.name
					}
			}
		}

		if (name === undefined) {
			return HList.make([])
		}

		const values = this.getRows()
			.map((row: DictVal): OptionalHVal | undefined =>
				row.get(name as string)
			)
			.filter((value): boolean => value !== undefined) as Value[]

		return HList.make(values as Value[])
	}

	/**
	 * Limit the grid only to the specified columns.
	 *
	 * This will return a new instance of a grid.
	 *
	 * ```typescript
	 * grid.filter('site').limitColumns(['id', 'dis']).inspect()
	 * ```
	 *
	 * @param names The column names.
	 * @returns A new grid instance with the specified columns.
	 */
	limitColumns<LimitDictVal extends HDict = DictVal>(
		names: string[]
	): HGrid<LimitDictVal> {
		return HGrid.make<LimitDictVal>({
			version: this.version,
			meta: this.meta.newCopy() as HDict,
			rows: this.getRows().map((dict: DictVal): LimitDictVal => {
				const newDict = new HDict()

				for (const name of names) {
					if (dict.has(name)) {
						newDict.set(name, dict.get(name) as HVal)
					}
				}

				return newDict as LimitDictVal
			}),
			columns: this.getColumns()
				.filter((col: GridColumn) => names.includes(col.name))
				.map(
					(
						col: GridColumn
					): {
						name: string
						meta?: HDict
					} => ({ name: col.name, meta: col.meta.newCopy() as HDict })
				),
		})
	}

	/**
	 * Iterate over a grid using dicts for rows.
	 *
	 * This enables a 'for ... of' loop to be used directly on an iterator.
	 *
	 * @returns A new iterator for a grid.
	 *
	 * ```typescript
	 * // Iterate a grid
	 * for (let dict of grid) {
	 *   console.log(dict)
	 * }
	 *
	 * // Destructure a grid into an array of dicts...
	 * const fooDict = [...grid].filter((dict): boolean => dict.get('foo') === 'foo')[0]
	 * ```
	 */
	[Symbol.iterator](): Iterator<DictVal> {
		return new GridDictIterator(this)
	}

	/**
	 * ```typescript
	 * if (grid.isEmpty()) {
	 *   // Grid is empty.
	 * }
	 * ```
	 *
	 * @returns true if the grid is empty.
	 */
	isEmpty(): boolean {
		return this.length === 0
	}

	/**
	 * Selects a range from the grid.
	 *
	 * The start and end can be used to specify a range...
	 * ```typescript
	 * // from [0, 1, 2, 3, 4, 5] to [1, 2, 3, 4]
	 * grid.filter('site').range(1, 4).inspect()
	 * ```
	 *
	 * //If only the first argument then a quantity can be used...
	 * ```typescript
	 * // select the first 4 rows - [0, 1, 2, 4]...
	 * grid.filter('site').range(4).inspect()
	 * ```
	 *
	 * @param startOrQuantity The start of the range or quantity.
	 * @param end Optional end range.
	 * @returns This grid instance.
	 */
	range(startOrQuantity: number, end?: number): this {
		const rows = this.getRows()

		if (end === undefined) {
			end = --startOrQuantity
			startOrQuantity = 0
		}

		if (startOrQuantity <= end) {
			for (let i = rows.length; i >= 0; --i) {
				if (i < startOrQuantity || i > end) {
					this.remove(i)
				}
			}
		}

		return this
	}

	/**
	 * Return the sum of values for the specified column.
	 *
	 * ```typescript
	 * const grid = HGrid.make({
	 *   rows: [
	 *     { id: 34, num: 1 },
	 *     { id: 35, num: 2 },
	 *     { id: 36, num: 3 },
	 *   ]
	 * })
	 * // Sum all the values in the num column (6)
	 * const sum = grid.sumOf('num')
	 * ```
	 *
	 * @param column The column name, column index or column instance.
	 * @returns The sum of all the numeric values.
	 */
	sumOf(column: string | number | GridColumn): number {
		return this.listBy(column).sum
	}

	/**
	 * Return the maximum value in the specified column.
	 *
	 * If there are no numbers then Number.MIN_SAFE_INTEGER is returned.
	 *
	 * ```typescript
	 * const grid = HGrid.make({
	 *   rows: [
	 *     { id: 34, num: 1 },
	 *     { id: 35, num: 2 },
	 *     { id: 36, num: 3 },
	 *   ]
	 * })
	 * // Return the maximum value in the num column (3).
	 * const max = grid.maxOf('num')
	 * ```
	 *
	 * @param column The column name, column index or column instance.
	 * @returns The maximum numerical value found.
	 */
	maxOf(column: string | number | GridColumn): number {
		return this.listBy(column).max
	}

	/**
	 * Return the minimum of value in the specified column.
	 *
	 * If there are no numbers then Number.MAX_SAFE_INTEGER is returned.
	 *
	 * ```typescript
	 * const grid = HGrid.make({
	 *   rows: [
	 *     { id: 34, num: 1 },
	 *     { id: 35, num: 2 },
	 *     { id: 36, num: 3 },
	 *   ]
	 * })
	 * // Return the maximum value in the num column (1).
	 * const min = grid.minOf('num')
	 * ```
	 *
	 * @param column The column name, column index or column instance.
	 * @returns The minimum numerical value found.
	 */
	minOf(column: string | number | GridColumn): number {
		return this.listBy(column).min
	}

	/**
	 * Return the sum of values for the specified column.
	 *
	 * If there are no numbers then Number.NaN is returned.
	 *
	 * ```typescript
	 * const grid = HGrid.make({
	 *   rows: [
	 *     { id: 34, num: 1 },
	 *     { id: 35, num: 2 },
	 *     { id: 36, num: 3 },
	 *   ]
	 * })
	 * // Return average of the num column (2).
	 * const avg = grid.avgOf('num')
	 * ```
	 *
	 * @param column The column name, column index or column instance.
	 * @returns The average of all the numeric values.
	 */
	avgOf(column: string | number | GridColumn): number {
		return this.listBy(column).avg
	}

	/**
	 * ```typescript
	 * if (grid.isError()) {
	 *   // Do something.
	 * }
	 * ```
	 *
	 * @returns true if the grid has an error associated with it.
	 */
	isError(): boolean {
		return this.meta.has('err')
	}

	/**
	 * ```typescript
	 * const err = grid.getError()
	 * if (err) {
	 *   // Do something with the error.
	 * }
	 * ```
	 *
	 * @returns Error information or undefined if not available.
	 */
	getError(): undefined | { type: string; trace: string; dis: string } {
		if (!this.isError()) {
			return undefined
		}

		const errType = this.meta.get<HStr>('errType')
		const errTrace = this.meta.get<HStr>('errTrace')
		const dis = this.meta.get<HStr>('dis')

		return {
			type: (errType && errType.value) || '',
			trace: (errTrace && errTrace.value) || '',
			dis: (dis && dis.value) || '',
		}
	}

	/**
	 * @returns The grid as an array like object.
	 */
	asArrayLike(): ArrayLike<DictVal> {
		return this as unknown as ArrayLike<DictVal>
	}

	/**
	 * @returns A string representation of the value.
	 */
	toString(): string {
		return `[${this.getRows()
			.map((dict: DictVal): string => String(dict))
			.join(', ')}]`
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

		console.table(
			this.getRows().map(
				(
					row: DictVal
				): {
					[prop: string]: string | number
				} => {
					const obj: { [prop: string]: string } = {}

					for (const val of row) {
						obj[val.name] = String(val.value)
					}

					return obj
				}
			)
		)

		return this
	}

	/**
	 * Check whether the index number for the row is a valid number.
	 *
	 * @param index The row index number to check.
	 * @throws An error if the index number is invalid.
	 */
	private checkRowIndexNum(index: number): void {
		if (index < 0) {
			throw new Error('Row index must be greater than zero')
		}
	}

	/**
	 * @returns Returns a copy of the grid.
	 */
	newCopy(): HGrid<DictVal> {
		return HGrid.make<DictVal>({
			version: this.version,
			meta: this.meta.newCopy() as HDict,
			rows: this.getRows().map(
				(dict: DictVal): DictVal => dict.newCopy() as DictVal
			),
			columns: this.getColumns().map(
				(
					col: GridColumn
				): {
					name: string
					meta?: HDict
				} => ({ name: col.name, meta: col.meta.newCopy() as HDict })
			),
		})
	}

	/**
	 * @returns The value as a grid.
	 */
	toGrid(): HGrid<DictVal> {
		return this
	}

	/**
	 * @returns The value as a list.
	 */
	toList(): HList<DictVal> {
		return HList.make(this.getRows())
	}

	/**
	 * @returns The value as a dict.
	 */
	toDict(): HDict {
		const obj: HValObj = {}

		const rows = this.getRows()
		for (let i = 0; i < rows.length; ++i) {
			obj[`row${i}`] = rows[i]
		}

		return HDict.make(this)
	}
}
