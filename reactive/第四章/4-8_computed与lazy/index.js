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

// ===== test-start

const effectFn = effect(
  () => obj.foo + obj.bar,
  // option
  {
    lazy: true,
  }
);

function computed(getter) {
  // 缓存上一次的计算结果
  let value;
  // 标志是否需要重新计算结果， true意味着‘脏’，需要重新计算
  let dirty = true;

  // 把getter 作为副作用函数， 创建一个lazy的副作用函数
  const effectFn = effect(getter, {
    lazy: true,
    scheduler(fn) {
      // note: 这里fn为什么不需要执行？因为这是一个lazy的effect，它的执行时机是由其他地方控制的，并且会作为effct的返回值返回出去
      // 也就是说fn === effectFn

      if (!dirty) {
        // getter中的当依赖发生变化时，调度器会在trigger中调用，此时更改dirty标识，下次访问时就能重新计算
        dirty = true;
      }

      trigger(obj, "value");
    },
  });

  const obj = {
    // 当读取obj.value时，才真正执行effectFn
    get value() {
      // ‘脏’时重新计算
      if (dirty) {
        value = effectFn();
        // 更改标识，下次访问时不重新计算，取缓存值
        dirty = false;
      }

      // 处理嵌套的场景，访问computed时，手动收集依赖
      track(obj, "value");

      return value;
    },
  };

  return obj;
}

const sumRes = computed(() => obj.foo + obj.bar);

effect(() => {
  console.log("这是一个嵌套：", sumRes.value);
});
