export default function Header({
  activeChat,
  isSidebarOpen,
  setIsSidebarOpen
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
      <div className="header-title">{activeChat?.title || 'New Chat'}</div>
    </header>
  );
}
