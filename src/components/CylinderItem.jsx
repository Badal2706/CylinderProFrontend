export default function CylinderItem({ item, index, gasTypes, cylinderSizes, onUpdate, onAddSerial, onRemoveSerial, onRemove, showRate }) {
  return (
    <div className="cart-item">
      <div className="form-row">
        <div className="form-group">
          <label>Gas Type</label>
          <select className="form-control" value={item.gas_type_id}
            onChange={(e) => onUpdate('gas_type_id', e.target.value)} required>
            <option value="">-- Select --</option>
            {gasTypes.map(type => (
              <option key={type.gas_type_id} value={type.gas_type_id}>{type.gas_type_name}</option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label>Cylinder Size</label>
          <select className="form-control" value={item.cylinder_size_id}
            onChange={(e) => onUpdate('cylinder_size_id', e.target.value)} required>
            <option value="">-- Select --</option>
            {cylinderSizes.map(size => (
              <option key={size.size_id} value={size.size_id}>{size.size_label}</option>
            ))}
          </select>
        </div>

        {showRate && (
          <div className="form-group">
            <label>Rate per Cylinder</label>
            <input type="number" className="form-control" value={item.rate}
              onChange={(e) => onUpdate('rate', parseFloat(e.target.value))}
              min="0" step="0.01" required />
          </div>
        )}
      </div>

      <div className="form-group">
        <label>Serial Numbers (Quantity: {item.quantity})</label>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <input type="text" className="form-control" value={item.serialInput}
            onChange={(e) => onUpdate('serialInput', e.target.value)}
            placeholder="Enter serial number and press Add"
            onKeyPress={(e) => { if (e.key === 'Enter') { e.preventDefault(); onAddSerial() } }} />
          <button type="button" className="btn btn-primary" onClick={onAddSerial}>Add</button>
        </div>

        <div className="serial-tags">
          {item.serial_numbers.map((serial, i) => (
            <div key={i} className="serial-tag">
              {serial}
              <button type="button" onClick={() => onRemoveSerial(i)}>×</button>
            </div>
          ))}
        </div>
      </div>

      {showRate && (
        <div className="form-group">
          <strong>Amount: ₹{item.amount.toFixed(2)}</strong>
        </div>
      )}

      <button type="button" className="btn btn-danger" onClick={onRemove}>Remove Item</button>
    </div>
  )
}
