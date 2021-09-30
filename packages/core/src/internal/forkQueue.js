import { noop, remove } from './utils'

/**
 Used to track a parent task and its forks
 用于跟踪父任务及其分支
 In the fork model, forked tasks are attached by default to their parent
 在fork模型中，fork任务默认附加到它们的父级
 We model this using the concept of Parent task && main Task
 我们使用Parent task（父任务） && main Task（主任务）的概念对此进行建模
 main task is the main flow of the current Generator, the parent tasks is the
 aggregation of the main tasks + all its forked tasks.
主任务是当前生成器的主要流程，父任务是主要任务+所有fork任务的聚合
 Thus the whole model represents an execution tree with multiple branches (vs the
 linear execution tree in sequential (non parallel) programming)
 因此，整个模型表示一个具有多个分支的执行数（相对于顺序（非并行）变成中的线性执行树）

 A parent tasks has the following semantics
 父任务具有以下语义
 - It completes if all its forks either complete or all cancelled
如果所有forks完成或全部取消，则父任务完成
 - If it's cancelled, all forks are cancelled as well
 如果父任务取消，所有forks也将取消
 - It aborts if any uncaught error bubbles up from forks
 如果任何未捕获的错误从forks中抛出，父任务会中止
 - If it completes, the return value is the one returned by the main task
 如果父任务完成，则返回值为主任务返回的值
 **/
export default function forkQueue(mainTask, onAbort, cont) {
  let tasks = []
  /** 任务结果 */
  let result
  let completed = false

  // 将主任务添加到任务队列中
  addTask(mainTask)
  /** 获取所有任务 */
  const getTasks = () => tasks

  /** 中止任务 */
  function abort(err) {
    onAbort()
    cancelAll()
    cont(err, true)
  }

  /** 添加任务 */
  function addTask(task) {
    tasks.push(task)
    // 每个任务有一个cont属性
    task.cont = (res, isErr) => {
      if (completed) {
        return
      }

      // 从任务中移除
      remove(tasks, task)
      task.cont = noop
      // 取消任务
      if (isErr) {
        abort(res)
      } else {
        // 完成任务，输出结果
        if (task === mainTask) {
          result = res
        }
        if (!tasks.length) {
          completed = true
          cont(result)
        }
      }
    }
  }

  /** 取消全部任务 */
  function cancelAll() {
    if (completed) {
      return
    }
    completed = true
    tasks.forEach(t => {
      t.cont = noop
      t.cancel()
    })
    tasks = []
  }

  return {
    addTask,
    cancelAll,
    abort,
    getTasks,
  }
}
