/* ============================================================================
 * favicon.js —— 把 favicon.svg 内联成 data URI（开发服务器与打包共用）
 * ---------------------------------------------------------------------------
 * 单文件版必须**零外部请求**，所以图标不能作为独立文件去引用，得内联。
 * 源文件 favicon.svg 保持可读（带注释与缩进），这里只在内联时去掉注释、压掉
 * 多余空白，再做最小必要的百分号编码。
 * ==========================================================================*/
'use strict';

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'favicon.svg');

function svgSource() {
  try {
    return fs.readFileSync(FILE, 'utf8');
  } catch (e) {
    return '';
  }
}

/** 去掉注释、压掉标签之间的空白 —— 只用于内联，磁盘上的源文件保持可读。 */
function minify(svg) {
  return svg
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/>\s+</g, '><')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** 只编码 data URI 里必须编码的那几个字符。 */
function encode(svg) {
  return svg
    .replace(/%/g, '%25')
    .replace(/"/g, '%22')
    .replace(/#/g, '%23')
    .replace(/</g, '%3C')
    .replace(/>/g, '%3E')
    .replace(/[\n\r]+/g, ' ');
}

const raw = svgSource();
const mini = raw ? minify(raw) : '';

module.exports = {
  file: FILE,
  hasIcon: !!raw,
  svg: mini,
  /** 直接塞进 <link rel="icon" href="..."> 的值；没有图标时退化成空 data URI。 */
  dataUri: mini ? 'data:image/svg+xml,' + encode(mini) : 'data:,'
};
