// 订阅助手入口扩展：侧边栏"批量添加" + Modal iframe
// Vanilla JS，无依赖。兼容 FreshRSS 1.24 -> edge。
(function () {
	'use strict';

	// ----- 读取 js_vars hook 注入的数据（window.context.extensions.batch_add.url） -----
	function getToolUrl() {
		if (window.context && window.context.extensions && window.context.extensions.batch_add &&
				window.context.extensions.batch_add.url) {
			return window.context.extensions.batch_add.url;
		}
		// 兜底（window.context 尚不可用 / 极老版本），应与 extension.php 的 TOOL_URL 一致
		return 'http://localhost:8081/';
	}

	// window.context 由 FreshRSS 的 main.js 解析。
	// edge 会派发 `freshrss:globalContextLoaded` 事件；FreshRSS 1.24 不会，
	// 因此轮询作为兜底。
	function onContextReady(cb) {
		if (window.context && window.context.extensions) {
			cb();
			return;
		}
		document.addEventListener('freshrss:globalContextLoaded', cb, { once: true });
		let tries = 0;
		const timer = setInterval(function () {
			if ((window.context && window.context.extensions) || ++tries > 100) {
				clearInterval(timer);
				if (window.context && window.context.extensions) {
					cb();
				}
			}
		}, 50);
	}

	// ----- 构建侧边栏入口（模拟 aside_feed.phtml 的标记结构） -----
	function addSidebarEntry() {
		const sidebar = document.querySelector('#aside_feed #sidebar');
		if (!sidebar) {
			return null; // 当前页面没有侧边栏
		}
		const li = document.createElement('li');
		li.className = 'item feed';
		const a = document.createElement('a');
		a.className = 'item-title';
		a.href = '#';
		a.textContent = '批量添加';
		a.addEventListener('click', function (ev) {
			ev.preventDefault();
			openModal();
		});
		li.appendChild(a);
		// 插到末尾的 .tree-bottom 之前，否则直接追加
		const bottom = sidebar.querySelector('.tree-bottom');
		if (bottom) {
			sidebar.insertBefore(li, bottom);
		} else {
			sidebar.appendChild(li);
		}
		return li;
	}

	// ----- Modal + iframe，样式复用 FreshRSS 主题的 CSS 变量 -----
	let modal = null;

	function openModal() {
		if (modal) {
			modal.style.display = 'flex';
			return;
		}
		const url = getToolUrl();

		modal = document.createElement('div');
		modal.style.cssText = [
			'position:fixed', 'inset:0', 'z-index:1000',
			'display:flex', 'align-items:center', 'justify-content:center',
			'background-color:var(--frss-modal-background-color-transparent, rgba(0,0,0,.4))'
		].join(';');

		const panel = document.createElement('div');
		panel.style.cssText = [
			'width:80vw', 'height:80vh', 'max-width:1000px',
			'display:flex', 'flex-direction:column',
			'background-color:var(--frss-background-color, #fff)',
			'border-radius:.25rem',
			'box-shadow:3px 3px 5px var(--frss-box-shadow-color-transparent, rgba(0,0,0,.2))'
		].join(';');

		const head = document.createElement('div');
		head.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:.5rem .75rem;border-bottom:1px solid var(--frss-border-color, #999)';

		const title = document.createElement('span');
		title.textContent = '批量添加';

		const close = document.createElement('button');
		close.type = 'button';
		close.textContent = '✕';
		close.style.cssText = 'border:none;background:none;cursor:pointer;color:var(--frss-font-color-dark, #000);font-size:1.1rem';
		close.addEventListener('click', closeModal);

		head.appendChild(title);
		head.appendChild(close);

		const iframe = document.createElement('iframe');
		iframe.src = url;
		iframe.style.cssText = 'flex:1;width:100%;border:none';

		panel.appendChild(head);
		panel.appendChild(iframe);
		modal.appendChild(panel);
		document.body.appendChild(modal);

		// 点击遮罩关闭
		modal.addEventListener('click', function (ev) {
			if (ev.target === modal) {
				closeModal();
			}
		});
		// Esc 关闭
		document.addEventListener('keydown', function (ev) {
			if (ev.key === 'Escape') {
				closeModal();
			}
		});
	}

	function closeModal() {
		if (modal) {
			modal.style.display = 'none';
		}
	}

	onContextReady(addSidebarEntry);
})();
