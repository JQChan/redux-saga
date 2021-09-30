import * as is from '../../../../is/src'
import { makeIterator } from '../utils'

const done = value => ({ done: true, value })
export const qEnd = {}

export function safeName(patternOrChannel) {
  if (is.channel(patternOrChannel)) {
    return 'channel'
  }

  if (is.stringableFunc(patternOrChannel)) {
    return String(patternOrChannel)
  }

  if (is.func(patternOrChannel)) {
    return patternOrChannel.name
  }

  return String(patternOrChannel)
}

/**
 * fsm（Finite State Machine有限状态机） ，生成一个saga迭代器
 * @param {*} fsm
 * @param {*} startState
 * @param {*} name
 * @returns
 */
export default function fsmIterator(fsm, startState, name) {
  let stateUpdater,
    errorState,
    effect,
    nextState = startState

  // saga迭代器的next
  function next(arg, error) {
    // 如果nextState === qEnd时，返回 { done: true, value: arg }
    if (nextState === qEnd) {
      return done(arg)
    }
    // 如果出现错误，抛出错误
    if (error && !errorState) {
      nextState = qEnd
      throw error
    } else {
      // 执行state更新
      stateUpdater && stateUpdater(arg)
      const currentState = error ? fsm[errorState](error) : fsm[nextState]()
      ;({ nextState, effect, stateUpdater, errorState } = currentState)
      // 如果nextState不为qEnd，返回effect
      return nextState === qEnd ? done(arg) : effect
    }
  }

  return makeIterator(next, error => next(null, error), name)
}
