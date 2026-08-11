{/* ─── STATS ────────────────────────────────────────────────────────── */}
<div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16, marginTop: 24 }}>
  <div className="card" style={{ padding: "18px 20px", textAlign: "center" }}>
    <div style={{ fontSize: 22, fontWeight: 800, color: "#10b981" }}>{members.length}</div>
    <div style={{ fontSize: 11, color: "#445566", marginTop: 4 }}>Total Members</div>
    <div style={{ fontSize: 9, color: "#2a3a55", marginTop: 2 }}>in the system</div>
  </div>
  <div className="card" style={{ padding: "18px 20px", textAlign: "center" }}>
    <div style={{ fontSize: 22, fontWeight: 800, color: "#f59e0b" }}>
      {members
        .filter(m => m.merchantCode === merchantData?.code)
        .reduce((sum, m) => sum + m.points, 0)
        .toLocaleString()}
    </div>
    <div style={{ fontSize: 11, color: "#445566", marginTop: 4 }}>Points Issued by You</div>
    <div style={{ fontSize: 9, color: "#2a3a55", marginTop: 2 }}>
      {merchantData?.name || merchantData?.code}
    </div>
  </div>
  <div className="card" style={{ padding: "18px 20px", textAlign: "center" }}>
    <div style={{ fontSize: 22, fontWeight: 800, color: "#60a5fa" }}>
      {members.filter(m => m.merchantCode === merchantData?.code).length}
    </div>
    <div style={{ fontSize: 11, color: "#445566", marginTop: 4 }}>Members Registered Here</div>
    <div style={{ fontSize: 9, color: "#2a3a55", marginTop: 2 }}>
      {merchantData?.name || merchantData?.code}
    </div>
  </div>
</div>