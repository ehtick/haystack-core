/*
 * Copyright (c) 2025, J2 Innovations. All Rights Reserved
 */

import { ListJsonStore } from '../../../src/core/list/ListJsonStore'
import { HNum } from '../../../src/core/HNum'
import { TEXT_ENCODER } from '../../../src/core/HVal'

import '../../matchers'
import '../../customMatchers'

describe('ListJsonStore', () => {
	describe('#values', () => {
		it('sets values', () => {
			const values = [HNum.make(42)]

			const store = new ListJsonStore<HNum>([])
			store.values = values

			expect(store.values).toEqual(values)
		})

		it('returns values', () => {
			const values = [42]
			const store = new ListJsonStore(values)

			expect(store.values.length).toBe(1)
			expect(store.values[0]).toValEqual(HNum.make(42))
		})
	}) // #values()

	describe('#toJSON()', () => {
		it('returns JSON', () => {
			const values = [42]
			expect(new ListJsonStore(values).toJSON()).toEqual([42])
		})

		it('returns JSON after changing the values', () => {
			const values = [42]
			const store = new ListJsonStore(values)
			store.values = [HNum.make(43)]
			expect(store.toJSON()).toEqual([43])
		})
	}) // #toJSON()

	describe('#toJSONString()', () => {
		it('returns a JSON string', () => {
			const values = [42]
			expect(new ListJsonStore(values).toJSONString()).toEqual('[42]')
		})
	}) // #toJSONString()

	describe('#toJSONUint8Array()', () => {
		it('returns a JSON byte buffer', () => {
			const values = [42]
			expect(new ListJsonStore(values).toJSONUint8Array()).toEqual(
				TEXT_ENCODER.encode('[42]')
			)
		})
	}) // #toJSONUint8Array()
})
