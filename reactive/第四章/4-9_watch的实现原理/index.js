//===================== proxy-start

// 存储副作用函数的桶
const bucket = new WeakMap();

// 原始数据
const data = { foo: 1, bar: 2 };

//对原始数据的代理
const obj = new Proxy(data, {
  // 拦截读取操作
  get(target, key) {
    // 将激活的副作用函数activeEffect添加到桶里
    track(target, key);
    // 返回属性值
    return target[key];
  },
  // 拦截设置操作
  set(target, key, value) {
    // 设置属性值
    target[key] = value;
    //将副作用函数取出并执行
    trigger(target, key);

    // 返回true代表设置成功
    return true;
  },
});

// 在get拦截函数内调用track函数追踪变化
function track(target, key) {
  // 没有activeEffect，直接return
  if (!activeEffect) return;
  // 根据target从桶中取得depsMap，它也是一个Map类型: key --> effects
  let depsMap = bucket.get(target);
  // 如果不存在depsMap，那么新建一个Map并与target关联
  if (!depsMap) {
    bucket.set(target, (depsMap = new Map()));
  }
  // 再根据key从depsMap中取得deps，它是一个set类型
  // 里面存储着所有与当前key相关联的副作用函数：effects
  let deps = depsMap.get(key);
  // 如果不存在deps，那么新建一个Mao并与key关联
  if (!deps) {
    depsMap.set(key, (deps = new Set()));
  }

  // 最后将当前的副作用函数添加到对应的Set中
  deps.add(activeEffect);

  activeEffect.deps.push(deps);
}

// 在set拦截函数内调用trigger函数触发变化
function trigger(target, key) {
  //根据target从桶中取出depsMap，它是 key --> effects
  const depsMap = bucket.get(target);
  if (!depsMap) return;

  // 根据key取得所有副作用函数 effects
  const effects = depsMap.get(key);

  // 使用额外的set解决无限循环问题♻️
  const effectsToRun = new Set();

  effects &&
    effects.forEach((effect) => {
      if (effect !== activeEffect) {
        effectsToRun.add(effect);
      }
    });
  // 执行副作用函数

  effectsToRun.forEach((effect) => {
    if (effect.option.scheduler) {
      effect.option.scheduler(effect);
    } else {
      effect();
    }
  });
}

// =================== proxy-end

// =================== effect-start

// 用一个全局变量存储被注册的副作用函数
let activeEffect;

// 新增一个effect栈
const effectStack = [];
// effect用于注册副作用函数
const effect = (fn, option = {}) => {
  const effectFn = () => {
    console.log("effectFn===执行");
    // 将副作用函数从依赖合集中清除
    cleanup(effectFn);

    // 记录当前正在执行的effect
    activeEffect = effectFn;

    // 将当前副作用函数压入栈中
    effectStack.push(effectFn);

    // 执行副作用函数,将副作用函数的结果存储在res中
    const res = fn();

    // 执行完毕后，将当前副作用函数弹出栈，并还原activeEffect的值（即还原为外层的副作用函数）
    effectStack.pop();

    // 还原外层副作用函数
    activeEffect = effectStack[effectStack.length - 1];

    // 将真正fn的返回值作为effectFn的返回值
    return res;
  };
  // 用于存储所有与该副作用函数相关的依赖
  effectFn.deps = [];

  // 将option 挂载到effectFn上
  effectFn.option = option;

  // 只有非lazy的时候，才执行
  if (!option.lazy) {
    effectFn();
  }

  // 将副作用函数作为函数的返回值返回
  return effectFn;
};

const cleanup = (effectFn) => {
  for (let i = 0; i < effectFn.deps.length; i++) {
    // deps依赖集合，track中的Set集合
    const deps = effectFn.deps[i];
    // 将effectFn从deps依赖集合中移除
    // note: 这里虽然会将effectFn先移除，但是在移除之后执行effectFn时，会重新读取依赖，建立新的联系
    deps.delete(effectFn);
  }
  effectFn.deps.length = 0;
};
// =================== effect-end

// ===== flushJob start

// 定义一个任务队列
// note: 为什么是set？因为一个赖多次变化是，调度器多次执行时是重复将同一个任务加入任务队列中
const jobQueue = new Set();

// 使用Promise.resolve()创建一个promise实例，用于将一个任务添加到微任务队列中
const p = Promise.resolve();

// 一个标志代表是否正在刷新队列
let isFlushing = false;
function flushJob() {
  if (isFlushing) return;

  isFlushing = true;

  p.then(() => {
    jobQueue.forEach((job) => job());
  }).finally(() => {
    isFlushing = false;
  });
}
// ===== flushJob end

// ===== watch start

function watch(source, cb) {
  // 定义getter
  let getter;
  if (typeof source === "function") {
    // 支持watch接收一个 getter 函数
    getter = source;
  } else {
    // 调用traverse函数读取source中的所有属性，建立依赖关系, 这样在修改任何属性是都能执行cb
    getter = () => traverse(source);
  }
  
  // 定义旧值与新值
  let oldValue, newValue;

  const effectFn = effect(() => getter(), {
    lazy: true,
    scheduler(fn) {
      // 当scheduler是执行时，一定是依赖也就是监听的source发生了变化，因此重新执行一次effectFn可以得到最新值
      newValue = effectFn();

      // 执行cb时，oldValue在外层执行手动调用副作用函数时已经被赋值了
      cb(newValue, oldValue);

      // 重置oldValue,不然下一次会得到错误oldValue
      // note: 因为对于下一次执行来说，这一次newValue就是旧的
      oldValue = newValue;  
    },
  });

  // 手动调用副作用函数拿到旧值
  // note: 由于上面的effect是lazy的，必须手动执行一次才能起到收集依赖的作用，同时由于lazy的设计
  // effectFn的执行结果就是getter函数的实际返回值，也就是我们需要的oldValue
  oldValue = effectFn();
}

function traverse(value, seen = new Set()) {
  // 如果要读取的数据是原始数据，则跳过
  if (typeof value !== "object" || value === null || seen.has(value)) return;

  // 将数据添加到set中，代表遍历地读取过该数据
  seen.add(value);

  // 遍历对象数据
  for (const key in value) {
    traverse(value[key], seen);
  }

  return value;
}
// ===== watch end

// ===== test-start
watch(() => obj.foo, (newValue, oldValue) => {
  console.log('newValue: ', newValue);
  console.log('oldValue: ', oldValue);
});
