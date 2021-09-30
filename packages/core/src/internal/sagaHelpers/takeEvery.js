import fsmIterator, { safeName } from './fsmIterator'
import { take, fork } from '../io'

export default function takeEvery(patternOrChannel, worker, ...args) {
  // {
  //   done: fasle,
  //   value: {
  //     ["@@redux-saga/IO"]: true,
  //     combinator: false,
  //     type: 'TAKE',
  //     payload: {
  //       pattern:
  //       patternOrChannel
  //     }
  //   }
  // }
  const yTake = { done: false, value: take(patternOrChannel) }
  // 接受一个action，返回fork
  const yFork = ac => ({ done: false, value: fork(worker, ...args, ac) })

  let action,
    setAction = ac => (action = ac)

  return fsmIterator(
    {
      q1() {
        return { nextState: 'q2', effect: yTake, stateUpdater: setAction }
      },
      q2() {
        return { nextState: 'q1', effect: yFork(action) }
      },
    },
    'q1',
    `takeEvery(${safeName(patternOrChannel)}, ${worker.name})`,
  )
}
