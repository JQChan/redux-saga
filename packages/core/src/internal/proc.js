import * as is from '../../../is/src'
import { IO, TASK_CANCEL } from '../../../symbols/src'
import { RUNNING, CANCELLED, ABORTED, DONE } from './task-status'
import effectRunnerMap from './effectRunnerMap'
import resolvePromise from './resolvePromise'
import nextEffectId from './uid'
import { asyncIteratorSymbol, noop, shouldCancel, shouldTerminate } from './utils'
import newTask from './newTask'
import * as sagaError from './sagaError'

/** 任务线程 cont => contact 通知 */
export default function proc(env, iterator, parentContext, parentEffectId, meta, isRoot, cont) {
  if (process.env.NODE_ENV !== 'production' && iterator[asyncIteratorSymbol]) {
    throw new Error("redux-saga doesn't support async generators, please use only regular ones")
  }

  const finalRunEffect = env.finalizeRunEffect(runEffect)

  /**
    Tracks the current effect cancellation
    每次迭代器进行迭代时，跟踪当前effect的取消，调用runEffect将设置一个新值。
    Each time the generator progresses. calling runEffect will set a new value
    取消会传播到子Effect中
    on it. It allows propagating cancellation to child effects
  **/
  next.cancel = noop

  /** Creates a main task to track the main flow */
  /** 创建一个主要任务来跟踪主要流程 */
  const mainTask = { meta, cancel: cancelMain, status: RUNNING }

  /**
   Creates a new task descriptor for this generator.
   为生成器创建一个新的任务描述符
   A task is the aggregation of it's mainTask and all it's forked tasks.
   一个任务是它的mainTask和它所有fork任务的聚合
   **/
  const task = newTask(env, mainTask, parentContext, parentEffectId, meta, isRoot, cont)

  /** 执行上下文 */
  const executingContext = {
    task,
    digestEffect,
  }

  /**
    cancellation of the main task. We'll simply resume the Generator with a TASK_CANCEL
    取消主要任务，使用TASK_CANCEL重置Generator
  **/
  function cancelMain() {
    if (mainTask.status === RUNNING) {
      mainTask.status = CANCELLED
      next(TASK_CANCEL)
    }
  }

  /**
    attaches cancellation logic to this task's continuation
    将取消逻辑附加到此任务的延续
    this will permit cancellation to propagate down the call chain
    这将允许取消沿着调用链传播 
  **/
  if (cont) {
    cont.cancel = task.cancel
  }

  // kicks up the generator
  /** 启动generator */
  next()

  // then return the task descriptor to the caller
  /** 将任务描述符返回给调用者 */
  return task

  /**
   * This is the generator driver
   * It's a recursive async/continuation function which calls itself
   * until the generator terminates or throws
   * @param {internal commands(TASK_CANCEL | TERMINATE) | any} arg - value, generator will be resumed with.
   * @param {boolean} isErr - the flag shows if effect finished with an error
   *
   * receives either (command | effect result, false) or (any thrown thing, true)
   */
  function next(arg, isErr) {
    try {
      let result
      /** 错误，抛出异常 */
      if (isErr) {
        result = iterator.throw(arg)
        // user handled the error, we can clear bookkept values
        sagaError.clear()
        /** 任务取消 */
      } else if (shouldCancel(arg)) {
        /**
          getting TASK_CANCEL automatically cancels the main task
          参数为TASK_CANCEL将自动取消主任务
          We can get this value here

          - By cancelling the parent task manually
          - By joining a Cancelled task
        **/
        mainTask.status = CANCELLED
        /**
          Cancels the current effect; this will propagate the cancellation down to any called tasks
          取消当前effect，取消将传播到任何被调用的任务
        **/
        next.cancel()
        /**
          If this Generator has a `return` method then invokes it
          This will jump to the finally block
          如果迭代器有return方法，调用迭代器的return，否则结果为{ done: true, value: 'TASK_CANCEL' }
        **/
        result = is.func(iterator.return) ? iterator.return(TASK_CANCEL) : { done: true, value: TASK_CANCEL }
        // 任务终结
      } else if (shouldTerminate(arg)) {
        // We get TERMINATE flag, i.e. by taking from a channel that ended using `take` (and not `takem` used to trap End of channels)
        result = is.func(iterator.return) ? iterator.return() : { done: true }
      } else {
        // 否则继续执行迭代器的next
        result = iterator.next(arg)
      }

      // 如果迭代器未结束，继续执行消化Effect，回调是next本身
      if (!result.done) {
        digestEffect(result.value, parentEffectId, next)
      } else {
        /**
          This Generator has ended, terminate the main task and notify the fork queue
          Generator结束，终止主任务并通知fork队列
        **/
        if (mainTask.status !== CANCELLED) {
          mainTask.status = DONE
        }
        mainTask.cont(result.value)
      }
    } catch (error) {
      if (mainTask.status === CANCELLED) {
        throw error
      }
      mainTask.status = ABORTED

      mainTask.cont(error, true)
    }
  }

  function runEffect(effect, effectId, currCb) {
    /**
      each effect runner must attach its own logic of cancellation to the provided callback
      it allows this generator to propagate cancellation downward.
      每个Effect运行器必须将取消逻辑附加到提供的回调，这样generator才能将取消逻辑传播下去
      ATTENTION! effect runners must setup the cancel logic by setting cb.cancel = [cancelMethod]
      And the setup must occur before calling the callback
      注意，Effect运行器必须通过设置cb.cancel = [cancelMethod]来设置取消逻辑，并且这个设置操作要在回调执行之前
      This is a sort of inversion of control: called async functions are responsible
      of completing the flow by calling the provided continuation; while caller functions
      are responsible for aborting the current flow by calling the attached cancel function
      被调用的异步函数负责通过调用提供的延续来完成流程；调用函数通过调用独家的取消函数来中止当前流程
      Library users can attach their own cancellation logic to promises by defining a
      promise[CANCEL] method in their returned promises
      ATTENTION! calling cancel must have no effect on an already completed or cancelled effect
      使用者可以通过定义promise中的promise['CANCEL']方法来提供取消逻辑，但是要注意，调用取消必须对已经完成或取消的Effect没有副作用
    **/
    // 如果Effect是promise
    if (is.promise(effect)) {
      resolvePromise(effect, currCb)
      // 如果Effect是迭代器，新起一个任务线程处理Effect
    } else if (is.iterator(effect)) {
      // resolve iterator
      proc(env, effect, task.context, effectId, meta, /* isRoot */ false, currCb)
      // 如果Effect有'@@redux-saga/IO'属性
    } else if (effect && effect[IO]) {
      // 从effectRunnerMap中匹配effect执行器
      const effectRunner = effectRunnerMap[effect.type]
      effectRunner(env, effect.payload, currCb, executingContext)
    } else {
      // anything else returned as is
      // 其他的Effect，回调处理Effect
      currCb(effect)
    }
  }

  /** 消化Effect */
  function digestEffect(effect, parentEffectId, cb, label = '') {
    const effectId = nextEffectId()
    env.sagaMonitor && env.sagaMonitor.effectTriggered({ effectId, parentEffectId, label, effect })

    /**
      completion callback and cancel callback are mutually exclusive
      We can't cancel an already completed effect
      And We can't complete an already cancelled effectId
      完成回调和取消回调是互斥的
      我们无法取消一个已完成的Effect
      也无法完成一个取消的Effect
      因此effectSettled来标记这个Effect是否已经执行完
    **/
    let effectSettled

    // Completion callback passed to the appropriate effect runner
    // 完成回调传递给适当的Effect执行器
    function currCb(res, isErr) {
      if (effectSettled) {
        return
      }

      effectSettled = true
      // 执行完的effect不能取消
      cb.cancel = noop // defensive measure
      if (env.sagaMonitor) {
        if (isErr) {
          env.sagaMonitor.effectRejected(effectId, res)
        } else {
          env.sagaMonitor.effectResolved(effectId, res)
        }
      }

      if (isErr) {
        sagaError.setCrashedEffect(effect)
      }

      // 执行下一个next
      cb(res, isErr)
    }
    // tracks down the current cancel
    // 追踪当前的取消
    currCb.cancel = noop

    // setup cancellation logic on the parent cb
    // 在父回调上设置取消逻辑
    cb.cancel = () => {
      // prevents cancelling an already completed effect
      // 防止取消已经完成的Effect
      if (effectSettled) {
        return
      }

      effectSettled = true

      // 向下传播取消逻辑
      currCb.cancel() // propagates cancel downward
      currCb.cancel = noop // defensive measure

      env.sagaMonitor && env.sagaMonitor.effectCancelled(effectId)
    }

    // 执行Effect
    finalRunEffect(effect, effectId, currCb)
  }
}
