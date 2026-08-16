export default function Sidebar({
  chats,
  activeChatId,
  isStreaming,
  isSidebarOpen,
  setIsSidebarOpen,
  onNewChat,
  onSelectChat,
  onDeleteChat,
  onClearHistory,
  appMode,
}) {
  const itemLabel = appMode === 'chat' ? 'Chat' : 'Blog';

  return (
    <>
      {/* Mobile backdrop */}
      <div
        className={`sidebar-backdrop ${isSidebarOpen ? 'open' : ''}`}
        onClick={() => setIsSidebarOpen(false)}
        aria-hidden="true"
      />

      <aside
        className={`sidebar ${isSidebarOpen ? 'open' : 'closed'}`}
        aria-label="Sidebar navigation"
      >
        {/* Brand header */}
        <div className="sidebar-header">
          <div className="sidebar-brand">
            <div className="brand-icon" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z"/>
                <circle cx="9" cy="15" r="1" fill="currentColor"/>
                <circle cx="15" cy="15" r="1" fill="currentColor"/>
              </svg>
            </div>
            <span>Agentic AI</span>
          </div>

          <button
            className="new-chat-btn"
            onClick={onNewChat}
            disabled={isStreaming}
            aria-label={`New ${itemLabel}`}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            New {itemLabel}
          </button>
        </div>

        {/* Chat list */}
        <div className="chat-list-container" role="navigation" aria-label={`${itemLabel} history`}>
          {chats.length > 0 && (
            <div className="chat-list-label">Recent</div>
          )}
          <div className="chat-list" role="list">
            {chats.map((chat) => (
              <div
                key={chat.id}
                role="listitem"
                className={`chat-item-wrapper ${chat.id === activeChatId ? 'active' : ''}`}
              >
                <button
                  className="chat-item"
                  onClick={() => onSelectChat(chat.id)}
                  title={chat.title}
                  disabled={isStreaming}
                  aria-current={chat.id === activeChatId ? 'page' : undefined}
                >
                  {appMode === 'chat' ? (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                    </svg>
                  ) : (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                      <polyline points="14 2 14 8 20 8"/>
                    </svg>
                  )}
                  <span>{chat.title}</span>
                </button>

                <button
                  className="delete-chat-btn"
                  onClick={(e) => onDeleteChat(chat.id, e)}
                  title={`Delete ${itemLabel.toLowerCase()}`}
                  disabled={isStreaming}
                  aria-label={`Delete ${chat.title}`}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="sidebar-footer">
          <button
            className="clear-history-btn"
            onClick={onClearHistory}
            disabled={isStreaming}
            aria-label={`Clear all ${itemLabel.toLowerCase()} history`}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
            Clear all {itemLabel.toLowerCase()}s
          </button>
          <div className="footer-info">Agentic Chatbot · v1.0</div>
        </div>
      </aside>
    </>
  );
}
