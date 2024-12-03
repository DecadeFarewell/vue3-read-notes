//===================== proxy-start

// 存储副作用函数的桶
const bucket = new WeakMap();

// 原始数据
const data = { ok: true, text: "hello word" };

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

  activeEffect.deps.push(deps)
}

// 在set拦截函数内调用trigger函数触发变化
function trigger(target, key) {
  //根据target从桶中取出depsMap，它是 key --> effects
  const depsMap = bucket.get(target);
  if (!depsMap) return;

  // 根据key取得所有副作用函数 effects
  const effects = depsMap.get(key);

  // 使用额外的set解决无限循环问题♻️
  const effectsToRun = new Set(effects);
  // 执行副作用函数
  // effects && effects.forEach((fn) => fn());
  effectsToRun.forEach((effect) => effect());
}

// =================== proxy-end

// =================== effect-start

// 用一个全局变量存储被注册的副作用函数
let activeEffect;
// effect用于注册副作用函数
const effect = (fn) => {
  const effectFn = () => {
    activeEffect = effectFn

    cleanup(effectFn)

    fn()
  }
  // 用于存储所有与该副作用函数相关的依赖
  effectFn.deps = []

  effectFn()
};

const cleanup = (effectFn) => {
  for(let i = 0; i < effectFn.deps.length; i++){
    // deps依赖集合，track中的Set集合
    const deps = effectFn.deps[i]
    // 将effectFn从deps依赖集合中移除
    // note: 这里虽然会将effectFn先移除，但是在移除之后执行effectFn时，会重新读取依赖，建立新的联系
    deps.delete(effectFn)
  }
  effectFn.deps.length = 0
}

effect(() => {
  console.log("effct run ");
  document.body.innerText = obj.ok ? obj.text : 'not';
});

setTimeout(() => {
  obj.ok = false;
}, 1000);

setTimeout(() => {
  obj.text = 'hello vue3'
}, 2000);
// =================== effect-end


