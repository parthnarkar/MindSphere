import React from "react";
import { API } from "../hooks/helper";

export default function Resources() {
  return (
    <div>
      <h2 className="text-2xl font-semibold mb-4">Resource Library</h2>
      <div className="bg-white p-4 rounded shadow">
        <p className="mb-2">Videos, guides and audios in regional languages (prototype placeholders).</p>
        <ul className="list-disc ml-5">
          <li>Intro to coping skills — English / Hindi / Regional</li>
          <li>How to support a friend — Short video</li>
          <li>Offline resource map — list of nearby counselors and helplines</li>
        </ul>
      </div>
    </div>
  );
}
