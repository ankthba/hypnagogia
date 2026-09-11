import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Overview from './pages/Overview';
import Criticality from './pages/Criticality';
import Learning from './pages/Learning';
import Replay from './pages/Replay';
import Methods from './pages/Methods';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Overview />} />
        <Route path="/criticality" element={<Criticality />} />
        <Route path="/learning" element={<Learning />} />
        <Route path="/replay" element={<Replay />} />
        <Route path="/methods" element={<Methods />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
