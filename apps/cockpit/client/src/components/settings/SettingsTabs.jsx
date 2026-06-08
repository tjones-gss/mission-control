import { useState } from 'react'
import { NotificationsTab } from './NotificationsTab.jsx'
import { SoundsVoiceTab } from './SoundsVoiceTab.jsx'
import { ShortcutsTab } from './ShortcutsTab.jsx'
import { TrustedFoldersTab } from './TrustedFoldersTab.jsx'

const TABS = [
  { id: 'notifications', label: 'Notifications' },
  { id: 'sounds', label: 'Sounds & Voice' },
  { id: 'shortcuts', label: 'Shortcuts' },
  { id: 'security', label: 'Security' },
]

export function SettingsTabs({ soundEngine, shortcuts, updateShortcut, resetShortcuts }) {
  const [activeTab, setActiveTab] = useState('notifications')

  return (
    <div>
      <div className="flex border-b border-gray-700">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
              activeTab === tab.id
                ? 'text-gray-200 border-b-2 border-indigo-500'
                : 'text-gray-500 hover:text-gray-400'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="px-5 py-4">
        {activeTab === 'notifications' && <NotificationsTab soundEngine={soundEngine} />}
        {activeTab === 'sounds' && <SoundsVoiceTab soundEngine={soundEngine} />}
        {activeTab === 'shortcuts' && (
          <ShortcutsTab
            shortcuts={shortcuts}
            updateShortcut={updateShortcut}
            resetShortcuts={resetShortcuts}
          />
        )}
        {activeTab === 'security' && <TrustedFoldersTab />}
      </div>
    </div>
  )
}
