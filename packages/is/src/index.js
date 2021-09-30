import { TASK, MULTICAST, IO, SAGA_ACTION } from '../../symbols/src'

export const undef = v => v === null || v === undefined
export const notUndef = v => v !== null && v !== undefined
export const func = f => typeof f === 'function'
export const number = n => typeof n === 'number'
export const string = s => typeof s === 'string'
export const array = Array.isArray
export const object = obj => obj && !array(obj) && typeof obj === 'object'
export const promise = p => p && func(p.then)
export const iterator = it => it && func(it.next) && func(it.throw)
export const iterable = it => (it && func(Symbol) ? func(it[Symbol.iterator]) : array(it))
export const task = t => t && t[TASK]
// 是否为一个saga的action，包含一个@@redux-saga/SAGA_ACTION属性
export const sagaAction = a => Boolean(a && a[SAGA_ACTION])
export const observable = ob => ob && func(ob.subscribe)
export const buffer = buf => buf && func(buf.isEmpty) && func(buf.take) && func(buf.put)
export const pattern = pat => pat && (string(pat) || symbol(pat) || func(pat) || (array(pat) && pat.every(pattern)))
// 是否为一个channel，一个channel包含take和close两个属性，且为函数
export const channel = ch => ch && func(ch.take) && func(ch.close)
export const stringableFunc = f => func(f) && f.hasOwnProperty('toString')
export const symbol = sym =>
  Boolean(sym) && typeof Symbol === 'function' && sym.constructor === Symbol && sym !== Symbol.prototype
// 是否为多播channel，多播的channel包含一个@@redux-saga/MULTICAST属性
export const multicast = ch => channel(ch) && ch[MULTICAST]
export const effect = eff => eff && eff[IO]
