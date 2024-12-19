const { ref, effect } = VueReactivity;

function createRenderer(options) {
  // 通过 options 得到操作DOM的API
  const { createElement, insert, setElementText } = options;
  function mountELement(vnode, container) {
    // 调用 createElement 创建dom元素
    const el = createElement(vnode.type);

    // 处理子节点，如果是字符串，代表是文本节点
    if (typeof vnode.children === "string") {
      // 调用 setElementText 设置元素的文本节点
      setElementText(el, vnode.children);
    }
    // 调用insert, 将元素添加到容器中
    insert(el, container)
  }

  function patch(n1, n2, container) {
    if (!n1) {
      // n1不存在，挂载
      mountELement(n2, container);
    } else {
      // n1存在，打补丁
    }
  }

  function render(vnode, container) {
    if (vnode) {
      // 新的存在
      // todo: patch
      patch(container._vnode, vnode, container);
    } else {
      // 新的不存在，旧的存在
      if (container._vnode) {
        // todo: 卸载
        container.innerHTML = "";
      }
    }

    container._vnode = vnode;
  }

  return { render };
}

/**
 * 自定义渲染器并不是’黑魔法‘，它只是通过抽象的手段，让核心代码不再依赖于平台特有的API，
 * 再通过支持个性化配置的能力，从而实现跨平台。
 */
const renderer = createRenderer({
  createElement: (tag) => document.createElement(tag),
  setElementText: (el, text) => {
    el.textContent = text;
  },
  insert: (el, parent, anchor = null) => {
    parent.insertBefore(el, anchor);
  },
});

const vnode = {
  type: 'div',
  children: "kwok's render"
}

effect(() => {
  renderer.render(vnode, document.getElementById("app"));
});
