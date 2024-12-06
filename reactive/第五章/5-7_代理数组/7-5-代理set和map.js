//===================== proxy-start

// 存储副作用函数的桶
const bucket = new WeakMap();

const ITERATE_KEY = Symbol();

// 操作类型枚举
const TriggerType = {
  SET: "SET",
  ADD: "ADD",
  DEL: "DEL",
};

// 定义map，存储 原始对象 与 代理对象的映射
const reactiveMap = new Map();

const reactive = (data) => {
  // 通过原始对象查找代理对象，如果存在直接返回
  const existionProxy = reactiveMap.get(data);
  if (existionProxy) return existionProxy;

  // 否则，创建新的代理对象
  const proxy = createReactive(data);

  // 保存新的代理对象，防止后续重复创建
  reactiveMap.set(data, proxy);

  return proxy;
};

const reactiveShallow = (data) => {
  return createReactive(data, true);
};

const readOnly = (data) => {
  return createReactive(data, false /**isShallow */, true);
};

const readOnlyShallow = (data) => {
  return createReactive(data, true /**isShallow */, true);
};

const arrayInstrumentation = {};

["includes", "indexOf", "lastIndexOf"].forEach((method) => {
  const originMethod = Array.prototype[method];

  arrayInstrumentation[method] = function (...args) {
    // 当前 method 使用 Reflect 改变了this，此时this指向代理对象
    // 先在代理对象中查找
    let res = originMethod.apply(this, args);

    if (!res) {
      // 若找不到，去原对象中找
      res = originMethod.apply(this.raw, args);
    }

    return res;
  };
});

// 设置标记是否允许进行依赖追踪
let shouldTrack = true;
["push", "pop", "shift", "unshift", "splice"].forEach((method) => {
  const originMethod = Array.prototype[method];

  arrayInstrumentation[method] = function (...args) {
    // 这些方法会间接读组数组的 length 属性，会建立响应式联系，但实际执行push方法并不需要建立与 length 的响应式联系
    shouldTrack = false;

    // 执行push方法的默认行为
    const res = originMethod.apply(this, args);

    // 执行完毕，恢复标识，允许追踪
    shouldTrack = true;

    return res;
  };
});

const createReactive = (data, isShallow = false, isReadonly = false) => {
  //对原始数据的代理
  const obj = new Proxy(data, {
    // 拦截属性读取操作， obj.foo
    get(target, key, receiver) {
      // 代理对象可以通过raw属性访问到原始对象
      if (key === "raw") {
        return target;
      }

      // 如果是目标对象是数组，且访问的数组方法存在于arrayInstrumentation中
      // 则返回定义在arrayInstrumentation上的值，以代理对象作为this
      if (Array.isArray(target) && arrayInstrumentation.hasOwnProperty(key)) {
        return Reflect.get(arrayInstrumentation, key, receiver);
      }

      // 非只读时，才需要建立响应联系（依赖收集） && key 为 symbol类型时不建立响应联系(遍历数组时会访问Symbol.iterator)
      if (!isReadonly && typeof key !== "symbol") {
        // 将激活的副作用函数activeEffect添加到桶里
        track(target, key);
      }

      // 使用Reflect.get来获取属性值， receiver为proxy代理对象，也就是obj， 用于改变this指像
      const res = Reflect.get(target, key, receiver);

      // 浅响应直接返回
      if (isShallow) {
        return res;
      }

      // 默认为深响应
      if (typeof res === "object" && res !== null) {
        // 递归调用，返回响应式对象
        return isReadonly ? readOnly(res) : reactive(res);
      }

      return res;
    },
    // 拦截 in 操作， key in obj
    has(target, key, receiver) {
      track(target, key);

      return Reflect.has(target, key, receiver);
    },
    // 拦截 for...in... 操作
    ownKeys(target) {
      // 这里是将副作用函数与ITERATE_KEY关联，而非某一个单独的属性
      // 如果是目标对象是数组，则应该与length属性进行关联
      track(target, Array.isArray(target) ? "length" : ITERATE_KEY);
      // track(target, ITERATE_KEY);

      return Reflect.ownKeys(target);
    },

    // 拦截删除操作 delete
    deleteProperty(target, key, receiver) {
      // 处理只读
      if (isReadonly) {
        console.warn(`属性${key} 是只读得`);
        return true;
      }

      const hasKey = Object.prototype.hasOwnProperty.call(target, key);

      const res = Reflect.deleteProperty(target, key, receiver);

      if (res && hasKey) {
        // 只有当删除成功且删除的是自己的属性时，才触发更新
        trigger(target, key, TriggerType.DEL);
      }

      return res;
    },
    // 拦截设置操作
    set(target, key, newValue, receiver) {
      // 处理只读
      if (isReadonly) {
        console.warn(`属性${key} 是只读得`);
        return true;
      }

      // 获取旧值
      const oldValue = target[key];
      const type = Array.isArray(target)
        ? Number(key) < target.length
          ? TriggerType.SET
          : TriggerType.ADD
        : Object.prototype.hasOwnProperty.call(target, key)
        ? TriggerType.SET
        : TriggerType.ADD;

      const res = Reflect.set(target, key, newValue, receiver);

      // 使用receiver.raw获取到代理的对象原始数据，如果与target相等，说明receiver就是target的代理对象
      // 防止receiver不是target的代理对象时，重复触发更新操作（屏蔽由原型触发的更新）
      if (target === receiver.raw) {
        /**
         * 只有当旧值与新值不相等，并且不是NaN时，才触发更新
         * NaN === NaN => false;
         * NaN !== NaN => true
         * 如果oldValue一开始是NaN，那么odlValue === oldValue 为 false，
         * 若newValue为NaN，同理 newValue === newValue 也为 false
         */
        if (
          oldValue !== newValue &&
          (oldValue === oldValue || newValue === newValue)
        ) {
          //将副作用函数取出并执行
          trigger(target, key, type, newValue);
        }
      }

      return res;
    },
  });

  return obj;
};

// 在get拦截函数内调用track函数追踪变化
function track(target, key) {
  // 没有activeEffect || 禁止追踪时，直接return
  if (!activeEffect || !shouldTrack) return;

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
function trigger(target, key, type, newValue) {
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

  // 对于for...in...操作，只由当操作类型为ADD|DEL时，才触发与与ITERATE_KEY相关联的副作用函数执行
  if (type === TriggerType.ADD || type === TriggerType.DEL) {
    // 取得与ITERATE_KEY相关联的副作用函数
    const iterateEffects = depsMap.get(ITERATE_KEY);
    // 与ITERATE_KEY相关的副作用函数添加到effectsToRun
    iterateEffects &&
      iterateEffects.forEach((effect) => {
        if (effect !== activeEffect) {
          effectsToRun.add(effect);
        }
      });
  }

  // 当操作类型是ADD，并且目标对象是数组时，将与length属性相关的副作用函数取出并执行
  if (type === TriggerType.ADD && Array.isArray(target)) {
    const lengthEffects = depsMap.get("length");
    // 与length属性相关的副作用函数添加到effectsToRun
    lengthEffects &&
      lengthEffects.forEach((effect) => {
        if (effect !== activeEffect) {
          effectsToRun.add(effect);
        }
      });
  }

  // 目标对象是数组，且修改了length属性
  if (Array.isArray(target) && key === "length") {
    // 对于索引大于等于新length值的元素
    // 需要将相关联的副作用函数添加到effectsToRun中待执行
    depsMap.forEach((effects, key) => {
      console.log("key: ", key);
      if (key >= newValue) {
        effects.forEach((effect) => {
          if (effect !== activeEffect) {
            effectsToRun.add(effect);
          }
        });
      }
    });
  }

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

// note: test start =====
