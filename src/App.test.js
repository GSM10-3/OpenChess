import { render, screen, fireEvent } from '@testing-library/react';
import App from './App';

test('로비에 플레이 버튼이 있고, 규칙 창에서 체스 규칙을 볼 수 있다', () => {
  render(<App />);
  expect(screen.getByRole('button', { name: '플레이' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '규칙 보기' }));
  expect(screen.getByText('캐슬링')).toBeInTheDocument();
});
