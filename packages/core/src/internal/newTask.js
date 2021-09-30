import deferred from '../../../deferred/src'
import * as is from '../../../is/src'
import { TASK, TASK_CANCEL } from '../../../symbols/src'
import { RUNNING, CANCELLED, ABORTED, DONE } from './task-status'
import { assignWithSymbols, check, createSetContextWarning, noop } from './utils'
import forkQueue from './forkQueue'
import * as sagaError from './sagaError'

/** 建立一个新任务 */
export default function newTask(env, mainTask, parentContext, parentEffectId, meta, isRoot, cont = noop) {
  /** 任务状态 */
  let status = RUNNING
  /** 任务结果 */
  let taskResult
  /** 任务错误 */
  let taskError
  /** 延迟结束 */
  let deferredEnd = null

  /** 由于错误取消的任务 */
  const cancelledDueToErrorTasks = []

  const context = Object.create(parentContext)
  /** 任务中的队列 */
  const queue = forkQueue(
    mainTask,
    function onAbort() {
      cancelledDueToErrorTasks.push(...queue.getTasks().map(t => t.meta.name))
    },
    end,
  )

  /**
   This may be called by a parent generator to trigger/propagate cancellation
   cancel all pending tasks (including the main task), then end the current task.
这可能会被父生成器调用/传播取消所有挂起的任务（包括主任务），然后结束当前任务
   Cancellation propagates down to the whole execution tree held by this Parent task
   It's also propagated to all joiners of this task and their execution tree/joiners
取消会向下传播到父任务持有的整个执行数，它还会传播到此任务的所有加入者及其执行树或加入者
   Cancellation is noop for terminated/Cancelled tasks tasks
   已终止或者取消任务的Cancellation是noop，即() => {}
   **/
  function cancel() {
    if (status === RUNNING) {
      // Setting status to CANCELLED does not necessarily mean that the task/iterators are stopped
      // 将任务状态设置为CANCELLED状态并不一定意味着任务或迭代器已停止
      // effects in the iterator's finally block will still be executed
      // 迭代器的finally块中的Effects仍会被执行
      status = CANCELLED
      queue.cancelAll()
      // Ending with a TASK_CANCEL will propagate the Cancellation to all joiners
      // 已TASK_CANCEL结尾会将Cancellation传播到所有加入者
      end(TASK_CANCEL, false)
    }
  }

  function end(result, isErr) {
    if (!isErr) {
      // The status here may be RUNNING or CANCELLED
      // If the status is CANCELLED, then we do not need to change it here
      if (result === TASK_CANCEL) {
        status = CANCELLED
      } else if (status !== CANCELLED) {
        status = DONE
      }
      taskResult = result
      deferredEnd && deferredEnd.resolve(result)
    } else {
      status = ABORTED
      // 将由于错误取消的任务加入到saga堆栈中
      sagaError.addSagaFrame({ meta, cancelledTasks: cancelledDueToErrorTasks })

      if (task.isRoot) {
        const sagaStack = sagaError.toString()
        // we've dumped the saga stack to string and are passing it to user's code
        // we know that it won't be needed anymore and we need to clear it
        sagaError.clear()
        env.onError(result, { sagaStack })
      }
      taskError = result
      deferredEnd && deferredEnd.reject(result)
    }
    task.cont(result, isErr)
    // 调用每个joiner的回调
    task.joiners.forEach(joiner => {
      joiner.cb(result, isErr)
    })
    task.joiners = null
  }

  function setContext(props) {
    if (process.env.NODE_ENV !== 'production') {
      check(props, is.object, createSetContextWarning('task', props))
    }

    assignWithSymbols(context, props)
  }

  function toPromise() {
    if (deferredEnd) {
      return deferredEnd.promise
    }

    deferredEnd = deferred()

    if (status === ABORTED) {
      deferredEnd.reject(taskError)
    } else if (status !== RUNNING) {
      deferredEnd.resolve(taskResult)
    }

    return deferredEnd.promise
  }

  const task = {
    // fields
    [TASK]: true,
    id: parentEffectId,
    meta,
    isRoot,
    context,
    joiners: [],
    queue,

    // methods
    cancel,
    cont,
    end,
    setContext,
    toPromise,
    isRunning: () => status === RUNNING,
    /*
      This method is used both for answering the cancellation status of the task and answering for CANCELLED effects.
      In most cases, the cancellation of a task propagates to all its unfinished children (including
      all forked tasks and the mainTask), so a naive implementation of this method would be:
        `() => status === CANCELLED || mainTask.status === CANCELLED`

      But there are cases that the task is aborted by an error and the abortion caused the mainTask to be cancelled.
      In such cases, the task is supposed to be aborted rather than cancelled, however the above naive implementation
      would return true for `task.isCancelled()`. So we need make sure that the task is running before accessing
      mainTask.status.

      There are cases that the task is cancelled when the mainTask is done (the task is waiting for forked children
      when cancellation occurs). In such cases, you may wonder `yield io.cancelled()` would return true because
      `status === CANCELLED` holds, and which is wrong. However, after the mainTask is done, the iterator cannot yield
      any further effects, so we can ignore such cases.

      See discussions in #1704
     */
    isCancelled: () => status === CANCELLED || (status === RUNNING && mainTask.status === CANCELLED),
    isAborted: () => status === ABORTED,
    result: () => taskResult,
    error: () => taskError,
  }

  return task
}
