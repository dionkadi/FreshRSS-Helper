// 订阅助手入口扩展：头部右上角 "+" 图标按钮 + Modal iframe
// Vanilla JS，无依赖。兼容 FreshRSS 1.24 -> edge。
// 幂等注入：onContextReady(done 收口) + DOM 检查 + window.__batchAddInjected 三层防重。
(function () {
	'use strict';

	// 与 extension.php 的 TOOL_URL 兜底一致
	const TOOL_URL_FALLBACK = 'http://localhost:8081/';
	const BUTTON_ID = 'btn-batch-add';
	const CONTEXT_EVENT = 'freshrss:globalContextLoaded';

	// ----- 读取 js_vars hook 注入的数据（window.context.extensions.batch_add.url） -----
	function getToolUrl() {
		if (window.context && window.context.extensions && window.context.extensions.batch_add &&
				window.context.extensions.batch_add.url) {
			return window.context.extensions.batch_add.url;
		}
		return TOOL_URL_FALLBACK;
	}

	// window.context 由 FreshRSS 的 main.js 解析。
	// edge 会派发 `freshrss:globalContextLoaded` 事件；FreshRSS 1.24 不会，
	// 因此轮询作为兜底。事件与轮询都收口到 finish()，done 标志保证只触发一次。
	function onContextReady(cb) {
		let done = false;
		let timer = null;
		let tries = 0;

		const stop = function () {
			if (timer) {
				clearInterval(timer);
				timer = null;
			}
			document.removeEventListener(CONTEXT_EVENT, onEvent);
		};
		const finish = function () {
			if (done) {
				return;
			}
			done = true;
			cb(stop);
		};
		const onEvent = function () {
			finish();
		};

		if (window.context && window.context.extensions) {
			finish();
			return;
		}

		document.addEventListener(CONTEXT_EVENT, onEvent, { once: true });
		timer = setInterval(function () {
			tries += 1;
			if ((window.context && window.context.extensions) || tries > 100) {
				finish();
			}
		}, 50);
	}

	// ----- 构建 "+" 图标按钮（克隆 .btn 自动继承主题的 hover/active/focus 外观） -----
	function buildAddButton(gear) {
		const btn = document.createElement('a');
		btn.id = BUTTON_ID;
		btn.className = 'btn';
		btn.href = '#';
		btn.title = '批量添加';
		btn.setAttribute('aria-label', '批量添加');
		// 与齿轮按钮保持间距并对齐（内联即可，无需额外 CSS 文件）
		btn.style.marginRight = '4px';
		btn.style.verticalAlign = 'middle';
		btn.addEventListener('click', function (ev) {
			ev.preventDefault();
			openModal();
		});

		// 图标：优先由齿轮图标 src 派生 add.svg，加载失败回退默认目录；
		// emoji 图标模式（齿轮是 <span class="icon">）或无齿轮图标时用 ➕。
		const gearIcon = gear ? gear.querySelector('img.icon') : null;
		const gearSrc = gearIcon ? gearIcon.getAttribute('src') : '';
		if (gearSrc && gearSrc.indexOf('configure.svg') !== -1) {
			const icon = document.createElement('img');
			icon.className = 'icon';
			icon.alt = '+';
			icon.loading = 'lazy';
			icon.src = gearSrc.replace('configure.svg', 'add.svg');
			icon.addEventListener('error', function onIconError() {
				icon.removeEventListener('error', onIconError);
				icon.src = '/themes/icons/add.svg'; // 回退到默认图标目录
			});
			btn.appendChild(icon);
		} else {
			const span = document.createElement('span');
			span.className = 'icon';
			span.textContent = '➕';
			btn.appendChild(span);
		}
		return btn;
	}

	// ----- 注入辅助 -----

	// 检测按钮与齿轮是否在同一行（top 差 >2px 视为堆叠）
	function buttonsAligned(btn, gear) {
		const btnTop = btn.getBoundingClientRect().top;
		const gearTop = gear.getBoundingClientRect().top;
		return Math.abs(btnTop - gearTop) <= 2;
	}

	// 压缩按钮横向 padding（Ansum/Mapco 等宽 padding 主题的最后手段）
	function compressButton(btn) {
		btn.style.paddingLeft = '4px';
		btn.style.paddingRight = '4px';
	}

	// ----- 注入 "+" 按钮（第二层防重：注入前检查 DOM） -----
	// 布局要点（根因：.item.configure 固定列宽 100px，Ansum/Mapco 等主题
	// `.btn { padding: 0.5rem 1.5rem }` 两个按钮共 ~132px 放不下即换行）：
	// 1. 把按钮与齿轮的 .dropdown 一起包进 inline-flex span（flex nowrap 永不换行）。
	//    .dropdown-menu 是 position:absolute;right:0，锚定在 .dropdown（position:relative）
	//    上，移入 wrap 不影响下拉菜单定位。
	// 2. 放宽 .item.configure 列宽（width:auto + min-width，内联优先级高于主题与媒体查询）。
	// 3. 兜底：插入后 + window load 后各检测一次是否仍堆叠，是则压缩按钮横向 padding。
	function inject() {
		if (document.getElementById(BUTTON_ID)) {
			return false; // 已注入，跳过
		}
		const nav = document.querySelector('.item.configure');
		if (!nav) {
			return false; // 头部结构不符合预期，本次放弃
		}
		const gear = nav.querySelector('a.dropdown-toggle');
		const btn = buildAddButton(gear);
		const dropdown = nav.querySelector('.dropdown');
		let wrap = null;

		if (dropdown) {
			wrap = document.createElement('span');
			// margin-right: 单元格内容右对齐，margin 在右缘留出间距（避免贴边）
			wrap.style.cssText = 'display:inline-flex;align-items:center;gap:4px;vertical-align:middle;margin-right:10px';
			wrap.appendChild(btn); // appendChild 会把元素从原位置移入（按钮尚未挂载）
			wrap.appendChild(dropdown); // 齿轮容器移入 wrap，下拉定位上下文保持不变
			nav.insertBefore(wrap, nav.firstChild);
		} else {
			// 兜底：没有 .dropdown 容器时直接插到最前
			nav.insertBefore(btn, nav.firstChild);
		}

		// 列宽策略：保持接近主题原始列宽（100px），避免 width:auto 把 configure
		// 列撑成"吞掉全部剩余空间"（实测 782px），导致搜索等其他列大幅偏移；
		// 若按钮组实际宽度超出（Ansum/Mapco 等宽内边距主题 ~132px），
		// 则按实测内容宽度放宽。text-align:right 保证内容贴右缘。
		const wrapWidth = wrap ? wrap.offsetWidth : (btn.offsetWidth || 0);
		nav.style.width = Math.max(100, wrapWidth + 12) + 'px';
		nav.style.textAlign = 'right';

		// 兜底检测：立即查一次；load 后（字体/图标加载完毕可能重排）再查一次
		if (gear) {
			if (!buttonsAligned(btn, gear)) {
				compressButton(btn);
			}
			const recheck = function () {
				if (!document.getElementById(BUTTON_ID)) {
					return;
				}
				if (!buttonsAligned(btn, gear)) {
					compressButton(btn);
				}
			};
			if (document.readyState === 'complete') {
				recheck();
			} else {
				window.addEventListener('load', recheck, { once: true });
			}
		}
		return true;
	}

	// ----- 统一入口（第一层收口 + 第三层全局标志保险） -----
	function run(stop) {
		// 无论注入是否成功，先清掉轮询与事件监听，收口只执行一次
		if (typeof stop === 'function') {
			stop();
		}
		// 第三层：全局标志
		if (window.__batchAddInjected) {
			return;
		}
		// 第二层：DOM 检查
		if (document.getElementById(BUTTON_ID)) {
			window.__batchAddInjected = true;
			return;
		}
		if (inject()) {
			window.__batchAddInjected = true;
		}
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
		panel.setAttribute('role', 'dialog');
		panel.setAttribute('aria-label', '批量添加');
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
		close.setAttribute('aria-label', '关闭');
		close.style.cssText = 'border:none;background:none;cursor:pointer;color:var(--frss-font-color-dark, #000);font-size:1.1rem';
		close.addEventListener('click', closeModal);

		head.appendChild(title);
		head.appendChild(close);

		const iframe = document.createElement('iframe');
		iframe.src = url;
		iframe.title = '订阅助手';
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

	// 第一层：onContextReady 内部 done 标志收口，注入统一走 run()
	onContextReady(run);
})();
