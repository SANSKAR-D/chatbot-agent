export default function Header({
  activeChat,
  isSidebarOpen,
  setIsSidebarOpen,
  appMode,
  setAppMode
}) {
  return (
    <header className="main-header">
      <button
        className="sidebar-toggle-btn"
        onClick={() => setIsSidebarOpen((prev) => !prev)}
        title={isSidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
        aria-label={isSidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
        aria-expanded={isSidebarOpen}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
          <line x1="9" y1="3" x2="9" y2="21"/>
        </svg>
      </button>

      <div className="header-title" title={activeChat?.title}>
        {activeChat?.title || (appMode === 'chat' ? 'New Chat' : 'New Blog')}
      </div>

      {/* Mode toggle */}
      <div
        role="group"
        aria-label="Switch application mode"
        className={`mode-slider-container ${appMode === 'blog' ? 'blog-active' : ''}`}
        onClick={() => setAppMode(appMode === 'chat' ? 'blog' : 'chat')}
      >
        <div className="mode-slider-bg" aria-hidden="true" />

        <div
          className={`mode-slider-option ${appMode === 'chat' ? 'active' : ''}`}
          role="button"
          aria-pressed={appMode === 'chat'}
          aria-label="Chat mode"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          Chat
        </div>

        <div
          className={`mode-slider-option ${appMode === 'blog' ? 'active' : ''}`}
          role="button"
          aria-pressed={appMode === 'blog'}
          aria-label="Blog mode"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
          </svg>
          Blog
        </div>
      </div>
    </header>
  );
}
