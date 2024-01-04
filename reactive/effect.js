//===================== proxy-start

// 存储副作用函数的桶
const bucket = new WeakMap();

// 原始数据
const data = { text: "hello word" };

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

  // 最后将激活的副作用函数添加到桶里
  deps.add(activeEffect);
}

// 在set拦截函数内调用trigger函数处罚变化
function trigger(target, key) {
  //根据target从桶中取出depsMap，它是 key --> effects
  const depsMap = bucket.get(target);
  if (!depsMap) return;

  // 根据key取得所有副作用函数 effects
  const effects = depsMap.get(key);

  // 执行副作用函数
  effects && effects.forEach((fn) => fn());
}

// =================== proxy-end

// =================== effect-start

// 用一个全局变量存储被注册的副作用函数
let activeEffect;
// effect用于注册副作用函数
const effect = (fn) => {
  activeEffect = fn;
  fn();
};

effect(() => {
  console.log("effct run ");
  document.body.innerText = obj.text;
});

setTimeout(() => {
  obj.text = "hello vue3";
}, 1000);
// =================== effect-end

// TODO: page-49
