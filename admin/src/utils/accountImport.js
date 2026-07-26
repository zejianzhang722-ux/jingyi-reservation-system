const roleMap = {
  '\u8d85\u7ea7\u7ba1\u7406\u5458': 'super_admin',
  '\u5bfc\u751f\u7ba1\u7406\u5458': 'admin',
  '\u4e66\u9662\u8f85\u5bfc\u5458': 'counselor',
  '\u8f85\u5bfc\u5458': 'counselor',
  '\u5bbf\u751f': 'student'
}

const scopeMap = {
  '\u5168\u9662': 'global',
  '\u5168\u4e66\u9662': 'global',
  '\u6307\u5b9a\u697c\u680b': 'building',
  '\u5177\u4f53\u697c\u680b': 'building',
  '\u697c\u680b': 'building'
}

function text(value) {
  return value === undefined || value === null ? '' : String(value).trim()
}

function firstValue(row, keys) {
  for (const key of keys) {
    const value = row[key]
    if (value !== undefined && value !== null && text(value) !== '') return value
  }
  return ''
}

export function readAccountImportWorkbook(XLSX, dataBuffer) {
  const workbook = XLSX.read(dataBuffer, { type: 'array' })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  if (!sheet) return []
  return XLSX.utils.sheet_to_json(sheet, { raw: false, defval: '' })
}

export function normalizeAccountImportRows(rows, accountType) {
  const normalizedType = accountType === 'manager' ? 'manager' : 'student'
  return rows.map(row => {
    const roleLabel = text(firstValue(row, ['\u89d2\u8272']))
    const scopeLabel = text(firstValue(row, ['\u7ba1\u7406\u8303\u56f4', '\u6570\u636e\u8303\u56f4']))
    return {
      accountType: normalizedType,
      username: text(firstValue(row, ['\u8d26\u53f7', '\u5b66\u53f7'])),
      realName: text(firstValue(row, ['\u771f\u5b9e\u59d3\u540d', '\u59d3\u540d'])),
      password: text(firstValue(row, ['\u5bc6\u7801', '\u4e00\u5361\u901a\u5361\u53f7'])),
      role: normalizedType === 'student' ? 'student' : (roleMap[roleLabel] || roleLabel || 'admin'),
      scopeType: normalizedType === 'manager' ? (scopeMap[scopeLabel] || scopeLabel) : '',
      buildingId: text(firstValue(row, ['\u697c\u680bID'])),
      buildingName: text(firstValue(row, ['\u697c\u680b', '\u697c\u680b\u540d\u79f0'])),
      phone: text(firstValue(row, ['\u7535\u8bdd', '\u624b\u673a\u53f7']))
    }
  })
}
