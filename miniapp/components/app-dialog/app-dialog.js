Component({
  options: { styleIsolation: 'apply-shared' },
  data: { visible: false, title: '', content: '', editable: false, draft: '', placeholder: '', sections: [], fields: [], reasons: [], reasonIndex: 0, busy: false, error: '', confirmText: '确定', showCancel: true, imageUrl: '', imageError: false },
  methods: {
    open: function(options) {
      this._options = options || {};
      var reasons = ['自行填写'].concat(options.reasons || ['申请信息不完整', '预约用途不符合要求', '时间或场地需调整', '请补充相关材料']);
      this.setData({ visible: true, title: options.title || '提示', content: options.editable ? '' : (options.content || ''),
        editable: !!options.editable, draft: options.value || '', placeholder: options.placeholderText || '请填写具体说明',
        sections: options.sections || [], imageUrl: options.imageUrl || '', imageError: false, fields: (options.fields || []).map(function(field) { return Object.assign({ value: '', type: 'text' }, field); }),
        reasons: reasons, reasonIndex: 0, busy: false, error: '', confirmText: options.confirmText || (options.editable ? '提交' : '确定'), showCancel: options.showCancel !== false });
    },
    stop: function() {},
    onImageError: function() { this.setData({ imageError: true }); },
    onPreview: function() { if (this.data.imageUrl && !this.data.imageError) wx.previewImage({ current: this.data.imageUrl, urls: [this.data.imageUrl] }); },
    onInput: function(e) { this.setData({ draft: e.detail.value, error: '' }); },
    onPreset: function(e) { var index = Number(e.detail.value); this.setData({ reasonIndex: index, draft: index ? this.data.reasons[index] : '', error: '' }); },
    onFieldInput: function(e) {
      var index = Number(e.currentTarget.dataset.index);
      var fields = this.data.fields.slice(); var field = fields[index];
      var value = field.type === 'select' ? field.options[Number(e.detail.value)].value : e.detail.value;
      fields[index] = Object.assign({}, field, { value: value, selectedLabel: field.type === 'select' ? field.options[Number(e.detail.value)].label : '' }); this.setData({ fields: fields, error: '' });
    },
    onCancel: function() {
      if (this.data.busy) return;
      this.setData({ visible: false });
      if (this._options.success) this._options.success({ confirm: false, cancel: true });
    },
    onConfirm: function() {
      if (this.data.busy) return;
      var draft = String(this.data.draft || '').trim();
      if (this.data.editable && !draft) { this.setData({ error: '请填写具体说明' }); return; }
      var values = {}, error = '';
      this.data.fields.forEach(function(field) {
        var value = String(field.value === undefined ? '' : field.value).trim(); values[field.key] = value;
        if (field.required && !value) error = '请填写' + field.label;
        if (field.type === 'number' && value && (!Number.isFinite(Number(value)) || !Number.isInteger(Number(value)) || (field.min !== undefined && Number(value) < field.min) || (field.max !== undefined && Number(value) > field.max))) error = field.label + '应为' + field.min + '至' + field.max + '的整数';
      });
      if (error) { this.setData({ error: error }); return; }
      var that = this;
      try {
        var result = this._options.success && this._options.success({ confirm: true, cancel: false, content: draft, values: values });
        if (result && typeof result.then === 'function') {
          this.setData({ busy: true }); result.then(function() { that.setData({ visible: false, busy: false }); }, function(err) { that.setData({ busy: false, error: (err && err.message) || '操作失败，请重试' }); });
        } else this.setData({ visible: false });
      } catch (err) { this.setData({ error: err.message || '操作失败，请重试' }); }
    }
  }
});
