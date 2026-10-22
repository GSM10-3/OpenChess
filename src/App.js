import { useState } from 'react';
import Lobby from './ui/Lobby';
import GameScreen from './ui/GameScreen';
import './App.css';

function App() {
  const [config, setConfig] = useState(null);
  const [last, setLast] = useState(null);
  const [round, setRound] = useState(0);

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
      key={`${config.seed}-${round}`}
      config={config}
      onExit={() => setConfig(null)}
      onRestart={() => setRound((r) => r + 1)}
    />
  );
}

export default App;
