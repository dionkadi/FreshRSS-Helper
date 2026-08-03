<?php
declare(strict_types=1);

/**
 * 自定义订阅助手入口扩展 (FreshRSS 1.24+)
 *
 * 功能：在 FreshRSS 侧边栏添加一个"批量添加"菜单项，点击后弹出
 *       Modal 窗口，以 iframe 内嵌订阅助手工具页面。
 *
 * 安装：将整个 xExtension-BatchAdd 目录复制到 FreshRSS 的 extensions/ 目录，
 *       然后在 设置 -> 扩展 中启用该扩展（type 为 user，按用户启用）。
 *
 * 重要说明：
 * 1. 请按你的实际部署修改 TOOL_URL / TOOL_DOMAIN 两个常量
 *    （必须是浏览器可达的地址，例如 http://<服务器IP或域名>:8081/）。
 * 2. FreshRSS 默认 CSP 为 default-src 'self'，iframe 加载站外地址时会被拦截，
 *    必须通过 $csp_policies 声明 frame-src（见下），声明会自动合并进页面 CSP。
 * 3. 本扩展基于官方扩展 API（源码验证）：
 *    - 侧边栏/菜单没有官方注入 hook，官方做法是 init() 里 appendScript 注入 JS，
 *      由 JS 创建 DOM（参考官方 xExtension-StickyFeeds / GridView 等扩展）。
 *    - 若你的 PHP 版本低于 8.3，不要使用 #[\Override] 属性（本文件未使用）。
 */

final class BatchAddExtension extends Minz_Extension {

    /** 订阅助手工具页地址（浏览器可达，请按实际部署修改） */
    private const TOOL_URL = 'http://localhost:8081/';

    /** iframe 来源域（CSP frame-src 用），需与 TOOL_URL 的协议+主机保持一致 */
    private const TOOL_DOMAIN = 'http://localhost:8081';

    /**
     * CSP 声明：FreshRSS 默认 CSP 是 default-src 'self'
     * （lib/Minz/ActionController.php::$csp_default），
     * 若不声明 frame-src，浏览器会拦截站外 iframe。
     * 扩展启用时，该数组会经 Minz_Extension::amendCsp() 合并进页面 CSP。
     */
    protected array $csp_policies = [
        'frame-src' => self::TOOL_DOMAIN,
    ];

    public function init(): void {
        parent::init();

        // 注入 static/script.js（经同源端点 p/ext.php 提供，符合 default-src 'self'）。
        // 注意：getFileUrl() 的第二个参数 $type 必须显式传 'js' / 'css'：
        //   - FreshRSS 1.24 的 getFileUrl() 要求必传 $type，p/ext.php 也校验 t 参数；
        //   - edge 版忽略该参数（按文件扩展名推断类型），显式传参可跨版本兼容。
        Minz_View::appendScript($this->getFileUrl('script.js', 'js'));

        // 通过 js_vars hook 把工具页地址传给前端 JS（写入 window.context.extensions）。
        // 字符串 hook 名在 1.24-1.27 与 1.28+（Minz_HookType::tryFrom()）均兼容。
        $this->registerHook('js_vars', [$this, 'jsVars']);
    }

    /**
     * js_vars hook：function(array $vars): array
     * 修改并返回传入的 $vars，结果合并进 window.context.extensions
     * （见 app/views/helpers/javascript_vars.phtml）。
     */
    public function jsVars(array $vars): array {
        $vars['batch_add'] = [
            'url' => self::TOOL_URL,
        ];
        return $vars;
    }
}
