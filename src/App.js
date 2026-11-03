import { useState } from 'react';
import Lobby from './ui/Lobby';
import GameScreen from './ui/GameScreen';
import './App.css';

function App() {
  const [config, setConfig] = useState(null);
  const [last, setLast] = useState(null);

  if (!config) {
    return (
      <Lobby
        initial={last}
        onStart={(c) => {
          setLast(c);
          setConfig(c);
        }}
      />
    );
  }
  return (
    <GameScreen
      key={config.seed}
      config={config}
      onExit={() => setConfig(null)}
      onRestart={() => setConfig((c) => ({ ...c, seed: (c.seed % 99999) + 1 }))} // 같은 설정, 새 지도
    />
  );
}

export default App;
