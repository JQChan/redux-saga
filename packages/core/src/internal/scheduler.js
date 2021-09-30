// 调度器，维护一个任务队列

/** 队列 */
const queue = []
/**
  Variable to hold a counting semaphore
  保持计数信号量的变量，1为挂起，0为释放
  - Incrementing adds a lock and puts the scheduler in a `suspended` state (if it's not
    already suspended)
  递增会添加一个锁并将调度器置于“挂起”状态（如果不是已经挂起）
  - Decrementing releases a lock. Zero locks puts the scheduler in a `released` state. This
    triggers flushing the queued tasks.
  递减会释放锁。零锁会将调度器置于“已释放”状态，这个会触发刷新排队的任务
**/
let semaphore = 0

/**
  Executes a task 'atomically'. Tasks scheduled during this execution will be queued
  and flushed after this task has finished (assuming the scheduler endup in a released
  state).
  以“原子”方式执行任务。 在此执行期间安排的任务将排队执行
   并在此任务完成后刷新（假设调度器最后已经置于“已释放”状态）。 
**/
function exec(task) {
  try {
    suspend()
    task()
  } finally {
    release()
  }
}

/**
  Executes or queues a task depending on the state of the scheduler (`suspended` or `released`)
  根据调度器的状态（已挂起或已释放）执行或排队任务
**/
export function asap(task) {
  queue.push(task)

  // 如果调度器是已释放状态，执行调度器里面的任务
  if (!semaphore) {
    suspend()
    flush()
  }
}

/**
 * Puts the scheduler in a `suspended` state and executes a task immediately.
 * 将调度器置于“已挂起”状态并立即执行任务
 */
export function immediately(task) {
  try {
    suspend()
    return task()
  } finally {
    flush()
  }
}

/**
  Puts the scheduler in a `suspended` state. Scheduled tasks will be queued until the
  scheduler is released.
  将调度器置于“已挂起”状态，计划任务将排队执行，直到调度器被释放
**/
function suspend() {
  semaphore++
}

/**
  Puts the scheduler in a `released` state.
  将调度器置于“已释放”状态
**/
function release() {
  semaphore--
}

/**
  Releases the current lock. Executes all queued tasks if the scheduler is in the released state.
  释放当前锁。如果调度器处于释放状态，则执行所有排队的任务
**/
function flush() {
  release()

  let task
  while (!semaphore && (task = queue.shift()) !== undefined) {
    exec(task)
  }
}
