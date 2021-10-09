/* eslint-disable no-console */
import delayP from '../../../delay-p/src'
import * as is from '../../../is/src'
import { IO, SELF_CANCELLATION } from '../../../symbols/src'
import { check, createSetContextWarning, identity } from './utils'
import * as effectTypes from './effectTypes'

const TEST_HINT =
  '\n(HINT: if you are getting these errors in tests, consider using createMockTask from @redux-saga/testing-utils)'

/**
 * 返回一个action对象
 * @param {*} type
 * @param {*} payload
 * @returns {{
 *   "@@redux-saga/IO": true,
 *   "combinator": false,
 *   "type": type,
 *   "payload": payload
 * }}
 */
const makeEffect = (type, payload) => ({
  [IO]: true,
  // this property makes all/race distinguishable in generic manner from other effects
  // currently it's not used at runtime at all but it's here to satisfy type systems
  combinator: false,
  type,
  payload,
})

const isForkEffect = eff => is.effect(eff) && eff.type === effectTypes.FORK

/**
 * 分离Effect
 * @param {*} eff
 * @returns {{
 *   "@@redux-saga/IO": true,
 *   "combinator": false,
 *    type: 'FORK',
 *    payload: {
 *        ...payload,
 *        detached: true
 *    }
 * }}
 */
export const detach = eff => {
  if (process.env.NODE_ENV !== 'production') {
    check(eff, isForkEffect, 'detach(eff): argument must be a fork effect')
  }
  return makeEffect(effectTypes.FORK, { ...eff.payload, detached: true })
}

/**
 * 创建一个Effect，用来命令middleware在store上等待指定的action
 * @param {*} patternOrChannel
 * @param {*} multicastPattern 多播模式
 * @returns {{
 *   "@@redux-saga/IO": true,
 *   "combinator": false,
 *    type: 'TAKE',
 *    payload: {
 *        pattern,
 *        channel
 *    }
 * }}
 */
export function take(patternOrChannel = '*', multicastPattern) {
  if (process.env.NODE_ENV !== 'production' && arguments.length) {
    check(arguments[0], is.notUndef, 'take(patternOrChannel): patternOrChannel is undefined')
  }
  //如果patternOrChannel为pattern， 返回{type: 'TAKE'， payload: {pattern: patternOrChannel }}
  if (is.pattern(patternOrChannel)) {
    if (is.notUndef(multicastPattern)) {
      console.warn(
        `take(pattern) takes one argument but two were provided. Consider passing an array for listening to several action types`,
      )
    }
    return makeEffect(effectTypes.TAKE, { pattern: patternOrChannel })
  }
  //如果patternOrChannel为multicast多播， 返回{type: 'TAKE'， payload: {channel: patternOrChannel, pattern: multicastPattern  }}
  if (is.multicast(patternOrChannel) && is.notUndef(multicastPattern) && is.pattern(multicastPattern)) {
    return makeEffect(effectTypes.TAKE, { channel: patternOrChannel, pattern: multicastPattern })
  }
  //如果patternOrChannel为channel， 返回{type: 'TAKE'， payload: {channel: patternOrChannel }}
  if (is.channel(patternOrChannel)) {
    if (is.notUndef(multicastPattern)) {
      console.warn(`take(channel) takes one argument but two were provided. Second argument is ignored.`)
    }
    return makeEffect(effectTypes.TAKE, { channel: patternOrChannel })
  }
  if (process.env.NODE_ENV !== 'production') {
    throw new Error(`take(patternOrChannel): argument ${patternOrChannel} is not valid channel or a valid pattern`)
  }
}

/**
 *
 * @param  {...any} args
 * @returns {{
 *   "@@redux-saga/IO": true,
 *   "combinator": false,
 *    type: 'TAKE',
 *    payload: {
 *        ...payload,
 *        maybe: true
 *    }
 * }}
 */
export const takeMaybe = (...args) => {
  const eff = take(...args)
  eff.payload.maybe = true
  return eff
}

/**
 *
 * @param {*} channel
 * @param {*} action
 * @returns {{
 *   "@@redux-saga/IO": true,
 *   "combinator": false,
 *    type: 'PUT',
 *    payload: {
 *        channel,
 *        action
 *    }
 * }}
 */
export function put(channel, action) {
  if (process.env.NODE_ENV !== 'production') {
    if (arguments.length > 1) {
      check(channel, is.notUndef, 'put(channel, action): argument channel is undefined')
      check(channel, is.channel, `put(channel, action): argument ${channel} is not a valid channel`)
      check(action, is.notUndef, 'put(channel, action): argument action is undefined')
    } else {
      check(channel, is.notUndef, 'put(action): argument action is undefined')
    }
  }
  if (is.undef(action)) {
    action = channel
    // `undefined` instead of `null` to make default parameter work
    channel = undefined
  }
  return makeEffect(effectTypes.PUT, { channel, action })
}

/**
 * 获取putResolve Effect
 * @param  {...any} args
 * @returns {{
 *   "@@redux-saga/IO": true,
 *   "combinator": false,
 *    type: 'PUT',
 *    payload: {
 *        channel,
 *        action,
 *        resolve: true
 *    }
 * }}
 */
export const putResolve = (...args) => {
  const eff = put(...args)
  eff.payload.resolve = true
  return eff
}

/**
 * 获取ALL Effect
 * @param {*} effects
 * @returns {{
 *   "@@redux-saga/IO": true,
 *   "combinator": true,
 *    type: 'ALL',
 *    payload: effects,
 * }}
 */
export function all(effects) {
  const eff = makeEffect(effectTypes.ALL, effects)
  eff.combinator = true
  return eff
}

/**
 * 获取RACE Effect
 * @param {*} effects
 * @returns {{
 *   "@@redux-saga/IO": true,
 *   "combinator": true,
 *    type: 'RACE',
 *    payload: effects,
 * }}
 */
export function race(effects) {
  const eff = makeEffect(effectTypes.RACE, effects)
  eff.combinator = true
  return eff
}

// this match getFnCallDescriptor logic
/**
 * 校验fn是否为函数
 * @param {*} effectName
 * @param {*} fnDescriptor
 * @returns
 */
const validateFnDescriptor = (effectName, fnDescriptor) => {
  check(fnDescriptor, is.notUndef, `${effectName}: argument fn is undefined or null`)

  if (is.func(fnDescriptor)) {
    return
  }

  let context = null
  let fn

  if (is.array(fnDescriptor)) {
    ;[context, fn] = fnDescriptor
    check(fn, is.notUndef, `${effectName}: argument of type [context, fn] has undefined or null \`fn\``)
  } else if (is.object(fnDescriptor)) {
    ;({ context, fn } = fnDescriptor)
    check(fn, is.notUndef, `${effectName}: argument of type {context, fn} has undefined or null \`fn\``)
  } else {
    check(fnDescriptor, is.func, `${effectName}: argument fn is not function`)
    return
  }

  if (context && is.string(fn)) {
    check(context[fn], is.func, `${effectName}: context arguments has no such method - "${fn}"`)
    return
  }

  check(fn, is.func, `${effectName}: unpacked fn argument (from [context, fn] or {context, fn}) is not a function`)
}

/**
 * 获取fn函数Call描述符
 * @param {*} fnDescriptor
 * @param {*} args
 */
function getFnCallDescriptor(fnDescriptor, args) {
  let context = null
  let fn

  // fnDescriptor是否为函数
  if (is.func(fnDescriptor)) {
    fn = fnDescriptor
  } else {
    // fnDescriptor是否为数组
    if (is.array(fnDescriptor)) {
      ;[context, fn] = fnDescriptor
    } else {
      // fnDescriptor为对象
      ;({ context, fn } = fnDescriptor)
    }

    // 如果context[fn]为函数
    if (context && is.string(fn) && is.func(context[fn])) {
      fn = context[fn]
    }
  }

  return { context, fn, args }
}

/**
 * 判断fn不是延迟的Effect
 * @param {*} fn
 * @returns
 */
const isNotDelayEffect = fn => fn !== delay

/**
 * 获取CALL Effect
 * @param {*} fnDescriptor
 * @param  {...any} args
 * @returns ({type: 'CALL', payload: { context, fn, args })
 */
export function call(fnDescriptor, ...args) {
  if (process.env.NODE_ENV !== 'production') {
    const arg0 = typeof args[0] === 'number' ? args[0] : 'ms'
    check(
      fnDescriptor,
      isNotDelayEffect,
      `instead of writing \`yield call(delay, ${arg0})\` where delay is an effect from \`redux-saga/effects\` you should write \`yield delay(${arg0})\``,
    )
    validateFnDescriptor('call', fnDescriptor)
  }
  return makeEffect(effectTypes.CALL, getFnCallDescriptor(fnDescriptor, args))
}

/**
 * 获取fnDescriptor的apply方法
 * @param {*} fnDescriptor
 * @param  {...any} args
 * @returns {{type: 'CALL', payload: { context, fn, args }}
 */
export function apply(context, fn, args = []) {
  const fnDescriptor = [context, fn]

  if (process.env.NODE_ENV !== 'production') {
    validateFnDescriptor('apply', fnDescriptor)
  }

  return makeEffect(effectTypes.CALL, getFnCallDescriptor([context, fn], args))
}

export function cps(fnDescriptor, ...args) {
  if (process.env.NODE_ENV !== 'production') {
    validateFnDescriptor('cps', fnDescriptor)
  }
  return makeEffect(effectTypes.CPS, getFnCallDescriptor(fnDescriptor, args))
}

/**
 * 获取
 * @param {*} fnDescriptor
 * @param  {...any} args
 * @returns {{type: 'FORK', payload: { context, fn, args }}
 */
export function fork(fnDescriptor, ...args) {
  if (process.env.NODE_ENV !== 'production') {
    validateFnDescriptor('fork', fnDescriptor)

    check(fnDescriptor, arg => !is.effect(arg), 'fork: argument must not be an effect')
  }
  return makeEffect(effectTypes.FORK, getFnCallDescriptor(fnDescriptor, args))
}

/**
 *
 * @param {*} fnDescriptor
 * @param  {...any} args
 * @returns ({ type: 'FORK', payload: {...payload, detached: true}})
 */
export function spawn(fnDescriptor, ...args) {
  if (process.env.NODE_ENV !== 'production') {
    validateFnDescriptor('spawn', fnDescriptor)
  }
  return detach(fork(fnDescriptor, ...args))
}

/**
 *
 * @param {*} taskOrTasks
 * @returns {{type: 'JOIN', payload: taskOrTasks}
 */
export function join(taskOrTasks) {
  if (process.env.NODE_ENV !== 'production') {
    if (arguments.length > 1) {
      throw new Error('join(...tasks) is not supported any more. Please use join([...tasks]) to join multiple tasks.')
    }
    if (is.array(taskOrTasks)) {
      taskOrTasks.forEach(t => {
        check(t, is.task, `join([...tasks]): argument ${t} is not a valid Task object ${TEST_HINT}`)
      })
    } else {
      check(taskOrTasks, is.task, `join(task): argument ${taskOrTasks} is not a valid Task object ${TEST_HINT}`)
    }
  }

  return makeEffect(effectTypes.JOIN, taskOrTasks)
}

/**
 *
 * @param {*} taskOrTasks
 * @returns {{type: 'CANCEL', payload: taskOrTasks}
 */
export function cancel(taskOrTasks = SELF_CANCELLATION) {
  if (process.env.NODE_ENV !== 'production') {
    if (arguments.length > 1) {
      throw new Error(
        'cancel(...tasks) is not supported any more. Please use cancel([...tasks]) to cancel multiple tasks.',
      )
    }
    if (is.array(taskOrTasks)) {
      taskOrTasks.forEach(t => {
        check(t, is.task, `cancel([...tasks]): argument ${t} is not a valid Task object ${TEST_HINT}`)
      })
    } else if (taskOrTasks !== SELF_CANCELLATION && is.notUndef(taskOrTasks)) {
      check(taskOrTasks, is.task, `cancel(task): argument ${taskOrTasks} is not a valid Task object ${TEST_HINT}`)
    }
  }

  return makeEffect(effectTypes.CANCEL, taskOrTasks)
}

/**
 *
 * @param {*} selector
 * @param  {...any} args
 * @returns {{type: 'SELECT', payload: {selector, args}}
 */
export function select(selector = identity, ...args) {
  if (process.env.NODE_ENV !== 'production' && arguments.length) {
    check(arguments[0], is.notUndef, 'select(selector, [...]): argument selector is undefined')
    check(selector, is.func, `select(selector, [...]): argument ${selector} is not a function`)
  }
  return makeEffect(effectTypes.SELECT, { selector, args })
}

/**
  channel(pattern, [buffer])    => creates a proxy channel for store actions
**/
/**
 * 为store的action创建一个代理channel
 * @param {*} pattern
 * @param {*} buffer
 * @returns {{type: 'ACTION_CHANNEL', payload: {  pattern, buffer }}
 */
export function actionChannel(pattern, buffer) {
  if (process.env.NODE_ENV !== 'production') {
    check(pattern, is.pattern, 'actionChannel(pattern,...): argument pattern is not valid')

    if (arguments.length > 1) {
      check(buffer, is.notUndef, 'actionChannel(pattern, buffer): argument buffer is undefined')
      check(buffer, is.buffer, `actionChannel(pattern, buffer): argument ${buffer} is not a valid buffer`)
    }
  }

  return makeEffect(effectTypes.ACTION_CHANNEL, { pattern, buffer })
}

/**
 *
 * @returns {{type: 'CANCELLED', payload: {}}
 */
export function cancelled() {
  return makeEffect(effectTypes.CANCELLED, {})
}
/**
 *
 * @returns {{type: 'FLUSH', payload: channel}
 */
export function flush(channel) {
  if (process.env.NODE_ENV !== 'production') {
    check(channel, is.channel, `flush(channel): argument ${channel} is not valid channel`)
  }

  return makeEffect(effectTypes.FLUSH, channel)
}
/**
 *
 * @returns {{type: 'GET_CONTEXT', payload: prop}
 */
export function getContext(prop) {
  if (process.env.NODE_ENV !== 'production') {
    check(prop, is.string, `getContext(prop): argument ${prop} is not a string`)
  }

  return makeEffect(effectTypes.GET_CONTEXT, prop)
}
/**
 *
 * @returns {{type: 'SET_CONTEXT', payload: props}
 */
export function setContext(props) {
  if (process.env.NODE_ENV !== 'production') {
    check(props, is.object, createSetContextWarning(null, props))
  }

  return makeEffect(effectTypes.SET_CONTEXT, props)
}

export const delay = call.bind(null, delayP)
