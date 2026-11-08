import type { GroupDefault } from '../domain/tableModel'
import type { MonthTintStrength } from '../ui/monthTints'
import { Modal } from './Common'
import { useSyncText } from './Home'
import { updateSettings, useSettings, type ThemeMode } from './settings'

const GROUP_OPTIONS: [GroupDefault, string][] = [
  ['EXPANDED', 'All expanded'],
  ['COLLAPSE_EXCEPT_CURRENT', 'Collapse all except current'],
]

function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map(([option, text]) => <option key={option} value={option}>{text}</option>)}
      </select>
    </label>
  )
}

export function SettingsDialog({ email, onSignOut, onClose }: { email: string | null; onSignOut: () => void; onClose: () => void }) {
  const settings = useSettings()
  const syncText = useSyncText()
  return (
    <Modal label="Settings" onClose={onClose}>
      <h2>Settings</h2>
      <Choice<ThemeMode>
        label="Theme"
        value={settings.theme}
        options={[['SYSTEM', 'System'], ['LIGHT', 'Light'], ['DARK', 'Dark']]}
        onChange={(theme) => updateSettings({ theme })}
      />
      <Choice<MonthTintStrength>
        label="Month colors"
        value={settings.monthTint}
        options={[['NORMAL', 'Normal'], ['SUBTLE', 'Subtle'], ['OFF', 'Off']]}
        onChange={(monthTint) => updateSettings({ monthTint })}
      />
      <Choice label="Months" value={settings.monthsDefault} options={GROUP_OPTIONS} onChange={(monthsDefault) => updateSettings({ monthsDefault })} />
      <Choice label="Years" value={settings.yearsDefault} options={GROUP_OPTIONS} onChange={(yearsDefault) => updateSettings({ yearsDefault })} />
      <label className="field">
        <span>Show quick picks in autocomplete</span>
        <input
          type="checkbox"
          checked={settings.showQuickPicksInAutocomplete}
          onChange={(e) => updateSettings({ showQuickPicksInAutocomplete: e.target.checked })}
        />
      </label>
      <p className="settings-account">
        {email && <strong>{email}</strong>}
        <span className="muted">{syncText}</span>
      </p>
      <div className="actions">
        <button className="danger" onClick={onSignOut}>Sign out</button>
        <button onClick={onClose}>Close</button>
      </div>
    </Modal>
  )
}
