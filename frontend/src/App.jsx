import { useState, useRef, useEffect, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import './index.css';

function App() {
  // Helper to load initial chats from localStorage or fallback to default new chat
  const getInitialChats = () => {
    const saved = localStorage.getItem('chatbot_chats');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch (e) {
        console.error("Error parsing chats from localStorage", e);
      }
    }
    return [{ id: 'chat_' + Date.now(), title: 'New Chat', messages: [] }];
  };

  const initialChats = getInitialChats();
  const [chats, setChats] = useState(initialChats);

  const [activeChatId, setActiveChatId] = useState(() => {
    const saved = localStorage.getItem('chatbot_active_chat_id');
    if (saved && initialChats.some(c => c.id === saved)) {
      return saved;
    }
    return initialChats[0]?.id || '';
  });

  const [isSidebarOpen, setIsSidebarOpen] = useState(window.innerWidth > 768);
  const shouldScrollSmoothRef = useRef(true);
  const [inputValue, setInputValue] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [confirmModal, setConfirmModal] = useState({
    isOpen: false,
    title: '',
    message: '',
    confirmText: 'Confirm',
    onConfirm: null
  });
  const messagesEndRef = useRef(null);

  useEffect(() => {
    localStorage.setItem('chatbot_chats', JSON.stringify(chats));
  }, [chats]);

  useEffect(() => {
    localStorage.setItem('chatbot_active_chat_id', activeChatId);
  }, [activeChatId]);

  // On mount, sync thread list from backend database
  useEffect(() => {
    const syncThreads = async () => {
      try {
        const response = await fetch('http://127.0.0.1:8000/chat/threads');
        if (response.ok) {
          const data = await response.json();
          if (data && data.threads && data.threads.length > 0) {
            // Update activeChatId to the first restored thread if currently selecting the temporary "New Chat"
            setActiveChatId((currentId) => {
              if (currentId && currentId.startsWith('chat_') && !data.threads.some(t => t.id === currentId)) {
                return data.threads[0].id;
              }
              return currentId;
            });

            setChats((prevChats) => {
              const mergedChats = [...prevChats];
              data.threads.forEach((backendThread) => {
                // Add the chat if it is not already in the frontend list
                if (!mergedChats.some((c) => c.id === backendThread.id)) {
                  mergedChats.push({
                    id: backendThread.id,
                    title: backendThread.title,
                    messages: [] // Loaded on demand when selected
                  });
                }
              });

              // Remove the default empty "New Chat" if backend chats were restored
              if (mergedChats.length > 1) {
                const firstChat = mergedChats[0];
                if (firstChat && firstChat.title === 'New Chat' && firstChat.messages.length === 0) {
                  return mergedChats.filter((c) => c.id !== firstChat.id);
                }
              }

              return mergedChats;
            });
          }
        }
      } catch (error) {
        console.error("Error syncing threads from backend:", error);
      }
    };
    syncThreads();
  }, []);

  // Fetch chat history from backend if active chat has no messages
  useEffect(() => {
    if (!activeChatId) return;

    const currentChat = chats.find((c) => c.id === activeChatId);
    if (currentChat && currentChat.messages.length === 0) {
      const fetchHistory = async () => {
        try {
          const response = await fetch(`http://127.0.0.1:8000/chat/history/${activeChatId}`);
          if (response.ok) {
            const data = await response.json();
            if (data && data.messages && data.messages.length > 0) {
              setChats((prevChats) =>
                prevChats.map((chat) => {
                  if (chat.id === activeChatId) {
                    let newTitle = chat.title;
                    if (chat.title === 'New Chat' || chat.title === '') {
                      const firstUserMessage = data.messages.find((m) => m.sender === 'user');
                      if (firstUserMessage) {
                        newTitle = firstUserMessage.text.slice(0, 30);
                        if (firstUserMessage.text.length > 30) newTitle += '...';
                      }
                    }
                    return { ...chat, title: newTitle, messages: data.messages };
                  }
                  return chat;
                })
              );
            }
          }
        } catch (error) {
          console.error("Error fetching chat history:", error);
        }
      };
      fetchHistory();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChatId]);

  const activeChat = chats.find(c => c.id === activeChatId) || chats[0];
  const messages = useMemo(() => activeChat?.messages || [], [activeChat]);

  const setMessages = (updater) => {
    setChats((prevChats) => {
      return prevChats.map((chat) => {
        if (chat.id === activeChatId) {
          const newMessages = typeof updater === 'function' ? updater(chat.messages) : updater;

          // Auto-rename chat title if it's the default "New Chat" and contains a user message
          let newTitle = chat.title;
          if (chat.title === 'New Chat' || chat.title === '') {
            const firstUserMessage = newMessages.find((m) => m.sender === 'user');
            if (firstUserMessage) {
              newTitle = firstUserMessage.text.slice(0, 30);
              if (firstUserMessage.text.length > 30) newTitle += '...';
            }
          }

          return { ...chat, title: newTitle, messages: newMessages };
        }
        return chat;
      });
    });
  };

  // Auto-scroll to bottom
  const scrollToBottom = (behavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  };

  useEffect(() => {
    scrollToBottom(shouldScrollSmoothRef.current ? 'smooth' : 'auto');
    shouldScrollSmoothRef.current = true;
  }, [messages, isStreaming]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!inputValue.trim() || isStreaming) return;

    const userMessage = inputValue.trim();
    setInputValue('');

    // Add user message to UI
    setMessages((prev) => [...prev, { text: userMessage, sender: 'user' }]);

    // Add an empty bot message that we will append to during streaming
    setMessages((prev) => [...prev, { text: '', sender: 'bot', isStreaming: true, isThinking: true }]);
    setIsStreaming(true);

    try {
      const response = await fetch('http://127.0.0.1:8000/chat/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: userMessage,
          thread_id: activeChatId
        }),
      });

      if (!response.ok) {
        throw new Error('Network response was not ok');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine) continue;

          if (trimmedLine.startsWith('data: ')) {
            const dataStr = trimmedLine.replace('data: ', '').trim();
            if (dataStr === '[DONE]') {
              setIsStreaming(false);
              setMessages((prev) => {
                const newMessages = [...prev];
                const lastIndex = newMessages.length - 1;
                newMessages[lastIndex] = { ...newMessages[lastIndex], isStreaming: false, isThinking: false };
                return newMessages;
              });
              break;
            }

            try {
              const data = JSON.parse(dataStr);
              if (data.chunk) {
                setMessages((prev) => {
                  const newMessages = [...prev];
                  const lastIndex = newMessages.length - 1;
                  newMessages[lastIndex] = {
                    ...newMessages[lastIndex],
                    text: newMessages[lastIndex].text + data.chunk,
                    isThinking: false
                  };
                  return newMessages;
                });
              } else if (data.error) {
                console.error("Server Error:", data.error);
                setMessages((prev) => {
                  const newMessages = [...prev];
                  const lastIndex = newMessages.length - 1;
                  newMessages[lastIndex] = {
                    ...newMessages[lastIndex],
                    text: newMessages[lastIndex].text + "\n[Error: " + data.error + "]",
                    isStreaming: false,
                    isThinking: false
                  };
                  return newMessages;
                });
                setIsStreaming(false);
              }
            } catch (err) {
              console.error("Error parsing JSON chunk", err, dataStr);
            }
          }
        }
      }
    } catch (error) {
      console.error('Error fetching stream:', error);
      setMessages((prev) => {
        const newMessages = [...prev];
        const lastIndex = newMessages.length - 1;
        newMessages[lastIndex] = {
          ...newMessages[lastIndex],
          text: newMessages[lastIndex].text + "\n[Connection Error]",
          isStreaming: false,
          isThinking: false
        };
        return newMessages;
      });
    } finally {
      setIsStreaming(false);
    }
  };

  // Sidebar Actions
  const handleNewChat = () => {
    if (isStreaming) return;
    const newId = 'chat_' + Date.now();
    const newChat = { id: newId, title: 'New Chat', messages: [] };
    setChats((prev) => [newChat, ...prev]);
    setActiveChatId(newId);
    if (window.innerWidth <= 768) {
      setIsSidebarOpen(false);
    }
  };

  const handleSelectChat = (chatId) => {
    if (isStreaming) return;
    shouldScrollSmoothRef.current = false;
    setActiveChatId(chatId);
    if (window.innerWidth <= 768) {
      setIsSidebarOpen(false);
    }
  };

  const handleDeleteChat = (chatId, e) => {
    e.stopPropagation();
    if (isStreaming) return;

    setConfirmModal({
      isOpen: true,
      title: 'Delete Chat',
      message: 'Are you sure you want to delete this chat conversation? This action cannot be undone.',
      confirmText: 'Delete',
      onConfirm: () => {
        const filtered = chats.filter((c) => c.id !== chatId);
        let nextChats = filtered;
        let nextActiveId = activeChatId;

        if (filtered.length === 0) {
          const newId = 'chat_' + Date.now();
          nextChats = [{ id: newId, title: 'New Chat', messages: [] }];
          nextActiveId = newId;
        } else if (activeChatId === chatId) {
          nextActiveId = filtered[0].id;
        }

        setChats(nextChats);
        setActiveChatId(nextActiveId);
      }
    });
  };

  const handleClearHistory = () => {
    if (isStreaming) return;

    setConfirmModal({
      isOpen: true,
      title: 'Clear Chat History',
      message: 'Are you sure you want to clear all chat conversations? This action cannot be undone.',
      confirmText: 'Clear All',
      onConfirm: () => {
        const newId = 'chat_' + Date.now();
        setChats([{ id: newId, title: 'New Chat', messages: [] }]);
        setActiveChatId(newId);
        if (window.innerWidth <= 768) {
          setIsSidebarOpen(false);
        }
      }
    });
  };

  // Helper to convert LaTeX delimiters \[ \] and \( \) to $$ and $ for remark-math
  const preprocessMarkdown = (text) => {
    return text
      .replace(/\\\[/g, '$$$$')
      .replace(/\\\]/g, '$$$$')
      .replace(/\\\(/g, '$')
      .replace(/\\\)/g, '$');
  };

  return (
    <div className="app-layout">
      {/* Mobile Sidebar Backdrop overlay */}
      <div
        className={`sidebar-backdrop ${isSidebarOpen ? 'open' : ''}`}
        onClick={() => setIsSidebarOpen(false)}
      />

      {/* Sliding Sidebar Drawer */}
      <aside className={`sidebar ${isSidebarOpen ? 'open' : 'closed'}`}>
        <div className="sidebar-header">
          <div className="sidebar-brand">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="brand-icon">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
              <path d="M12 2v4"></path>
              <path d="M8 5h8"></path>
              <path d="M12 11V6"></path>
            </svg>
            <span>Agentic Chatbot</span>
          </div>
          <button className="new-chat-btn" onClick={handleNewChat} disabled={isStreaming}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            New Chat
          </button>
        </div>

        <div className="chat-list-container">
          <div className="chat-list">
            {chats.map((chat) => (
              <div
                key={chat.id}
                className={`chat-item-wrapper ${chat.id === activeChatId ? 'active' : ''} ${isStreaming ? 'disabled' : ''}`}
              >
                <button
                  className="chat-item"
                  onClick={() => handleSelectChat(chat.id)}
                  title={chat.title}
                  disabled={isStreaming}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                  </svg>
                  {chat.title}
                </button>
                <button
                  className="delete-chat-btn"
                  onClick={(e) => handleDeleteChat(chat.id, e)}
                  title="Delete chat"
                  disabled={isStreaming}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    <line x1="10" y1="11" x2="10" y2="17"></line>
                    <line x1="14" y1="11" x2="14" y2="17"></line>
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="sidebar-footer">
          <button className="clear-history-btn" onClick={handleClearHistory} disabled={isStreaming}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
            Clear all chats
          </button>
          <div className="footer-info">ChatBot v1.0</div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="main-content">
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

        <div className="chat-container">
          <div className="messages">
            {messages.map((msg, idx) => (
              <div key={idx} className={`message ${msg.sender}`}>
                <div className="bubble">
                  {msg.isThinking ? (
                    <span className="thinking-text" />
                  ) : (
                    <ReactMarkdown
                      remarkPlugins={[remarkMath]}
                      rehypePlugins={[rehypeKatex]}
                      components={{
                        code({ inline, className, children, ...props }) {
                          const match = /language-(\w+)/.exec(className || '')
                          return !inline && match ? (
                            <SyntaxHighlighter
                              {...props}
                              style={vscDarkPlus}
                              language={match[1]}
                              PreTag="div"
                            >
                              {String(children).replace(/\n$/, '')}
                            </SyntaxHighlighter>
                          ) : (
                            <code {...props} className={className}>
                              {children}
                            </code>
                          )
                        }
                      }}
                    >
                      {preprocessMarkdown(msg.text + (msg.isStreaming ? ' █' : ''))}
                    </ReactMarkdown>
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          <div className="input-container">
            <form className="input-box" onSubmit={handleSubmit}>
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="Ask anything"
                disabled={isStreaming}
              />
              <button type="submit" className="send-btn" disabled={!inputValue.trim() || isStreaming}>
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M2.01 21L23 12L2.01 3L2 10l15 2l-15 2z"
                    fill="currentColor"
                  />
                </svg>
              </button>
            </form>
          </div>
        </div>
      </main>

      {/* Custom Confirmation Modal */}
      {confirmModal.isOpen && (
        <div className="confirm-modal-overlay">
          <div className="confirm-modal">
            <h3>{confirmModal.title}</h3>
            <p>{confirmModal.message}</p>
            <div className="confirm-modal-actions">
              <button
                className="confirm-btn cancel"
                onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
              >
                Cancel
              </button>
              <button
                className="confirm-btn confirm"
                onClick={() => {
                  if (confirmModal.onConfirm) confirmModal.onConfirm();
                  setConfirmModal(prev => ({ ...prev, isOpen: false }));
                }}
              >
                {confirmModal.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
