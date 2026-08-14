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
        title={isSidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
          <line x1="9" y1="3" x2="9" y2="21"></line>
        </svg>
      </button>
      <div className="header-title">{activeChat?.title || (appMode === 'chat' ? 'New Chat' : 'New Blog')}</div>
      
      <div 
        className={`mode-slider-container ${appMode === 'blog' ? 'blog-active' : ''}`} 
        onClick={() => setAppMode(appMode === 'chat' ? 'blog' : 'chat')}
      >
        <div className="mode-slider-bg"></div>
        <div className={`mode-slider-option ${appMode === 'chat' ? 'active' : ''}`}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
          Chat
        </div>
        <div className={`mode-slider-option ${appMode === 'blog' ? 'active' : ''}`}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
          Blog
        </div>
      </div>
    </header>
  );
}
