import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import './theme.css';
import './theme-v2.css';
import './schedule.css';
import './room.css';
import './onboarding.css';
import './storage-reliability.css';

const appStorageKeys = (): string[] => Object.keys(localStorage)
  .filter((key) => key.startsWith('shudong.') || key.startsWith('startnow.'));

/** Crash recovery must offer a byte-for-byte rescue path before any reset. */
const downloadRawStorageBackup = (): void => {
  try {
    const entries = appStorageKeys().map((key) => ({ key, raw: localStorage.getItem(key) }));
    const json = JSON.stringify({ format: 'startnow-raw-crash-backup-v1', exportedAt: Date.now(), entries }, null, 2);
    const href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = href;
    link.download = `startnow-crash-backup-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(href);
  } catch { alert('浏览器禁止读取本地存储，无法创建原始备份。'); }
};

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
        <p>可能是本地存档与当前版本不兼容。先刷新；如果仍无法打开，请先下载原始备份，再决定是否重置。</p>
        <p>原始备份可能包含私人内容及本机 API Key，请妥善保管，不要公开分享。</p>
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
            onClick={downloadRawStorageBackup}
            style={{ padding: '8px 18px', borderRadius: 999, border: '1px solid #e8e6dc', background: '#faf9f5', cursor: 'pointer' }}
          >
            下载原始备份
          </button>
          <button
            onClick={() => {
              if (!confirm('确定永久清空本机 StartNow 的全部数据吗？此操作不可撤销。建议先下载原始备份。')) return;
              try {
                appStorageKeys().forEach((key) => localStorage.removeItem(key));
                location.reload();
              } catch { alert('浏览器禁止删除本地数据，请检查隐私模式或存储权限。'); }
            }}
            style={{ padding: '8px 18px', borderRadius: 999, border: 0, background: '#c96442', color: '#faf9f5', cursor: 'pointer' }}
          >
            重置本地数据
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
