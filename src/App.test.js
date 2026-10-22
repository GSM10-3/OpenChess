import { render, screen } from '@testing-library/react';
import App from './App';

test('로비에 시작 버튼과 규칙이 보인다', () => {
  render(<App />);
  expect(screen.getByRole('button', { name: '시작' })).toBeInTheDocument();
  expect(screen.getByText('캐슬링')).toBeInTheDocument();
});
