import { ConnectButton } from '@rainbow-me/rainbowkit';
import '../styles/Header.css';

export function Header() {
  return (
    <header className="header">
      <div className="header-container">
        <div className="brand">
          <div className="brand-mark">
            <span className="pulse" />
          </div>
          <div>
            <p className="brand-subtitle">ZVerse</p>
            <h1 className="brand-title">Confidential Groups</h1>
          </div>
        </div>
        <div className="header-actions">
          <span className="net-pill">Sepolia</span>
          <ConnectButton showBalance={false} />
        </div>
      </div>
    </header>
  );
}
