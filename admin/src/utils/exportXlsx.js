// src/utils/exportXlsx.js
import * as XLSX from 'xlsx'
import { ElMessage } from 'element-plus'

/**
 * 分页拉取「筛选后全量」数据 —— 导出专用。
 *
 * 为什么不能直接传 pageSize:10000：
 * 后端多个列表路由挂载了 `paginationRules`（server/src/middleware/validator.js），
 * 其中约束 `query('pageSize').isInt({ min: 1, max: 100 })`，
 * 再加上各 controller 普遍有 `Math.min(100, pageSize)` 钳制。
 * 一次性请求超大 pageSize 会被校验直接打回 400「每页数量无效」，
 * 页面表现为「导出失败，请重试」。因此必须按页循环拉取。
 *
 * @param {Function} fetcher  形如 (params, options) => Promise 的 API 函数
 * @param {Object} baseParams 与列表页一致的筛选条件（不含 page/pageSize）
 * @param {Object} opts      { pageSize: 每页条数(<=100), maxPages: 最大拉取页数(防失控), options: 传给 fetcher 的第二个参数 }
 * @returns {Promise<Array>} 全量行数组
 */
export async function fetchAllPages(fetcher, baseParams = {}, opts = {}) {
  const pageSize = Math.min(100, opts.pageSize || 100)
  const maxPages = opts.maxPages || 50
  const options = opts.options || {}
  const all = []
  let page = 1
  let total = Number.POSITIVE_INFINITY

  while (page <= maxPages && all.length < total) {
    const res = await fetcher({ ...baseParams, page, pageSize }, options)
    const list = (res && res.data && res.data.list) || []
    if (page === 1) {
      total = Number(res && res.data && res.data.total) || 0
    }
    if (!list.length) break
    all.push(...list)
    // 最后一页：本页不足一整页，或已累计到 total
    if (list.length < pageSize) break
    page += 1
  }
  return all
}

/**
 * 将行数据导出为真实 .xlsx 并触发浏览器下载。
 * @param {Array<{header:string, key:string, width?:number, formatter?:(row:any)=>any}>} columns
 *         header: 表头中文；key: 行对象字段名；width: 列宽(wch)，缺省按表头长度*2；
 *         formatter: 可选，状态/枚举→中文标签、日期格式化等。
 * @param {Array<any>} rows  导出的行对象数组（建议为「筛选后全量」）
 * @param {string} baseName  文件名基准，如 "导出_预约列表"（自动追加 _YYYY-MM-DD.xlsx）
 * @returns {boolean} 是否成功触发下载
 */
export function exportXlsx(columns, rows, baseName) {
  if (!rows || !rows.length) {
    ElMessage.warning('暂无数据可导出')
    return false
  }
  const exportRows = rows.map(row => {
    const r = {}
    for (const col of columns) {
      r[col.header] = col.formatter ? col.formatter(row) : (row?.[col.key] ?? '')
    }
    return r
  })
  const ws = XLSX.utils.json_to_sheet(exportRows)
  ws['!cols'] = columns.map(c => ({ wch: c.width || Math.max(10, (c.header ? c.header.length : 8) * 2) }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '导出数据')
  const date = new Date().toISOString().slice(0, 10)
  XLSX.writeFile(wb, `${baseName}_${date}.xlsx`) // 现代浏览器均支持中文文件名；如需更强兼容可改 Blob+anchor+encodeURIComponent
  return true
}
