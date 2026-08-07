// Routes only — no page logic here.

import { Routes, Route, Link } from "react-router-dom";
import CreateLinkPage from "@/pages/CreateLinkPage";
import LinkListPage from "@/pages/LinkListPage";
import LinkStatsPage from "@/pages/LinkStatsPage";

export default function App() {
  return (
    <>
      <nav className="nav">
        <Link to="/">Create</Link>
        <Link to="/links">Links</Link>
      </nav>
      <Routes>
        <Route path="/" element={<CreateLinkPage />} />
        <Route path="/links" element={<LinkListPage />} />
        <Route path="/links/:code" element={<LinkStatsPage />} />
      </Routes>
    </>
  );
}
