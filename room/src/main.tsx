import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import './styles-chat.css';

class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('StartNow crashed:', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        style={{
          maxWidth: 560,
          margin: '80px auto',
          padding: '0 24px',
          font: '14px/1.8 system-ui, sans-serif',
          color: '#3d3d3a',
          textAlign: 'center',
        }}
      >
        <h1 style={{ fontSize: 20, marginBottom: 12 }}>页面没能打开</h1>
        <p>多半是本地存档和这一版对不上。先刷新一次；还不行就清掉本地数据重来。</p>
        <pre
          style={{
            textAlign: 'left',
            padding: 12,
            background: '#f0eee6',
            borderRadius: 8,
            fontSize: 12,
            overflow: 'auto',
          }}
        >
          {String(this.state.error.message || this.state.error)}
        </pre>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 16 }}>
          <button
            onClick={() => location.reload()}
            style={{ padding: '8px 18px', borderRadius: 999, border: '1px solid #e8e6dc', background: '#faf9f5', cursor: 'pointer' }}
          >
            刷新
          </button>
          <button
            onClick={() => {
              // 群聊页只重置自己的房间数据，不能连带清掉卡片版、API 配置和身份。
              ['shudong.room.v1', 'shudong.archives.v1', 'shudong.roomsettings.v1']
                .forEach((k) => localStorage.removeItem(k));
              location.reload();
            }}
            style={{ padding: '8px 18px', borderRadius: 999, border: 0, background: '#c96442', color: '#faf9f5', cursor: 'pointer' }}
          >
            重置群聊数据
          </button>
        </div>
      </div>
    );
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Boundary>
      <App />
    </Boundary>
  </StrictMode>,
);
