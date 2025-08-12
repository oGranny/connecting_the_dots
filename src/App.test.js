import { render, screen } from '@testing-library/react';
import App from './App';

test('renders workspace title', () => {
  render(<App />);
  expect(screen.getByText(/Document Workspace · Headings & Jumps/i)).toBeInTheDocument();
});
