import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useTheme } from "@/hooks/useTheme";
import { useToast } from "@/providers/toast";
import {
  FiEye, FiEyeOff, FiMail, FiLock, FiUser, FiSun, FiMoon,
  FiArrowRight, FiArrowLeft, FiPhone, FiCheck, FiBriefcase, FiHome, FiCalendar
} from "react-icons/fi";

export default function Register() {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const toast = useToast();
  const [form, setForm] = useState({
    username: "", email: "", password: "", confirmPassword: "",
    phone: "", medicalRole: "clinical_doctor", institution: "", department: "", yearsOfExperience: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(1);

  const updateField = (field: string, value: string) => setForm((p) => ({ ...p, [field]: value }));

  const strength = (() => {
    const { password } = form;
    if (!password) return 0;
    let s = 0;
    if (password.length >= 6) s++;
    if (password.length >= 10) s++;
    if (/[A-Z]/.test(password)) s++;
    if (/[0-9]/.test(password)) s++;
    if (/[^A-Za-z0-9]/.test(password)) s++;
    return Math.min(s, 5);
  })();
  const sLabels = ["", "弱", "较弱", "中等", "较强", "强"];
  const sColors = ["", "var(--m-red)", "var(--m-orange)", "var(--m-orange)", "var(--m-cyan)", "var(--m-green)"];

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();
    if (step === 1) {
      if (!form.username.trim()) { toast.error("请输入用户名"); return; }
      if (!form.email.trim()) { toast.error("请输入邮箱地址"); return; }
      if (!form.password) { toast.error("请输入密码"); return; }
      if (form.password.length < 6) { toast.error("密码长度至少6位"); return; }
      if (form.password !== form.confirmPassword) { toast.error("两次密码输入不一致"); return; }
      setStep(2);
      return;
    }
    // Step 2
    if (!form.phone.trim()) { toast.error("请输入手机号码"); return; }
    if (!form.institution.trim()) { toast.error("请输入所属机构"); return; }
    if (!agreed) { toast.error("请同意用户隐私协议"); return; }

    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      toast.success("注册成功", "正在跳转登录页面...");
      setTimeout(() => navigate("/login"), 800);
    }, 1200);
  };

  const feats = [
    { icon: <FiCheck size={14} />, text: "复杂版面精准识别" },
    { icon: <FiCheck size={14} />, text: "语义级智能切分" },
    { icon: <FiCheck size={14} />, text: "LightRAG 知识图谱" },
    { icon: <FiCheck size={14} />, text: "多模态医疗问答" },
  ];

  return (
    <div style={{ minHeight: "100vh", display: "flex", background: "var(--bg-base)", color: "var(--tx-700)" }}>
      {/* Left Panel — Brand */}
      <div className="hidden md:flex" style={{
        flex: 1, flexDirection: "column", justifyContent: "center", alignItems: "center",
        background: "linear-gradient(160deg,#070F1E 0%,#0F2B5B 45%,#0A3D62 100%)",
        color: "white", padding: "48px", position: "relative", overflow: "hidden",
      }}>
        <div style={{ position: "absolute", inset: 0, opacity: 0.06, backgroundImage: "radial-gradient(circle at 1px 1px,white 1px,transparent 0)", backgroundSize: "36px 36px" }} />
        <div style={{ position: "absolute", top: "5%", left: "8%", width: 300, height: 300, borderRadius: "50%", background: "rgba(37,99,235,0.12)", filter: "blur(70px)" }} />
        <div style={{ position: "absolute", bottom: "10%", right: "5%", width: 240, height: 240, borderRadius: "50%", background: "rgba(0,196,180,0.08)", filter: "blur(60px)" }} />

        <div style={{ position: "relative", zIndex: 1, maxWidth: 400 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 36 }}>
            <div style={{ width: 40, height: 40, borderRadius: 11, background: "rgba(255,255,255,0.10)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.14)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 19, fontWeight: 800 }}>M</div>
            <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.01em" }}>MedRAG</span>
          </div>
          <h1 style={{ fontSize: "clamp(24px,2.6vw,32px)", fontWeight: 700, lineHeight: 1.25, marginBottom: 14, letterSpacing: "-0.02em" }}>创建您的专业账户</h1>
          <p style={{ fontSize: 15, lineHeight: 1.6, opacity: 0.65, marginBottom: 32 }}>加入医疗文献智能知识库平台，开启科研效率新体验</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {feats.map((f, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 26, height: 26, borderRadius: 7, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.10)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "rgba(255,255,255,0.8)" }}>{f.icon}</div>
                <span style={{ fontSize: 14, opacity: 0.8 }}>{f.text}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ position: "absolute", bottom: 24, left: 48, right: 48, fontSize: 11, opacity: 0.3, letterSpacing: "0.03em" }}>MedRAG System v1.0 | 医疗文献 RAG 知识库赛事项目</div>
      </div>

      {/* Right — Form */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", padding: "48px 24px", position: "relative" }}>
        <button onClick={toggleTheme} style={{ position: "absolute", top: 20, right: 20, width: 36, height: 36, borderRadius: 8, border: "1px solid var(--bd-200)", background: "var(--bg-surface)", color: "var(--tx-300)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
          {theme === "light" ? <FiMoon size={15} /> : <FiSun size={15} />}
        </button>

        <div style={{ width: "100%", maxWidth: 420 }}>
          <div className="md:hidden" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
            <div style={{ width: 34, height: 34, borderRadius: 9, background: "linear-gradient(135deg,#2563EB,#00C4B4)", display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: 16, fontWeight: 800 }}>M</div>
            <span style={{ fontSize: 17, fontWeight: 700 }}>MedRAG</span>
          </div>

          {/* Step indicator */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 28, height: 28, borderRadius: "50%", background: step >= 1 ? "var(--m-primary)" : "var(--bg-hover)", color: step >= 1 ? "white" : "var(--tx-100)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>1</div>
              <span style={{ fontSize: 12, fontWeight: 600, color: step >= 1 ? "var(--tx-700)" : "var(--tx-100)" }}>账户信息</span>
            </div>
            <div style={{ flex: 1, height: 2, background: step >= 2 ? "var(--m-primary)" : "var(--bd-200)", borderRadius: 1 }} />
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 28, height: 28, borderRadius: "50%", background: step >= 2 ? "var(--m-primary)" : "var(--bg-hover)", color: step >= 2 ? "white" : "var(--tx-100)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>2</div>
              <span style={{ fontSize: 12, fontWeight: 600, color: step >= 2 ? "var(--tx-700)" : "var(--tx-100)" }}>从业信息</span>
            </div>
          </div>

          <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 6, letterSpacing: "-0.02em", color: "var(--tx-900)" }}>
            {step === 1 ? "注册新账户" : "完善从业信息"}
          </h2>
          <p style={{ fontSize: 14, color: "var(--tx-300)", marginBottom: 20 }}>
            {step === 1 ? "设置您的登录凭据" : "补充您的医疗专业信息"}
          </p>

          <form onSubmit={handleRegister}>
            {step === 1 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--tx-500)", marginBottom: 5 }}>用户名</label>
                  <div style={{ position: "relative" }}>
                    <FiUser size={15} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--tx-100)" }} />
                    <input type="text" value={form.username} onChange={(e) => updateField("username", e.target.value)} placeholder="请输入用户名" className="m-input" style={{ paddingLeft: 40 }} />
                  </div>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--tx-500)", marginBottom: 5 }}>邮箱地址</label>
                  <div style={{ position: "relative" }}>
                    <FiMail size={15} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--tx-100)" }} />
                    <input type="email" value={form.email} onChange={(e) => updateField("email", e.target.value)} placeholder="请输入邮箱" className="m-input" style={{ paddingLeft: 40 }} />
                  </div>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--tx-500)", marginBottom: 5 }}>登录密码</label>
                  <div style={{ position: "relative" }}>
                    <FiLock size={15} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--tx-100)" }} />
                    <input type={showPassword ? "text" : "password"} value={form.password} onChange={(e) => updateField("password", e.target.value)} placeholder="至少6位字符" className="m-input" style={{ paddingLeft: 40, paddingRight: 44 }} />
                    <button type="button" onClick={() => setShowPassword(!showPassword)} style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "var(--tx-100)", cursor: "pointer" }}>
                      {showPassword ? <FiEyeOff size={15} /> : <FiEye size={15} />}
                    </button>
                  </div>
                  {form.password && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                      <div style={{ flex: 1, height: 4, background: "var(--bd-200)", borderRadius: 2, overflow: "hidden" }}>
                        <div style={{ width: `${(strength / 5) * 100}%`, height: "100%", background: sColors[strength], transition: "all 0.3s", borderRadius: 2 }} />
                      </div>
                      <span style={{ fontSize: 11, color: sColors[strength], fontWeight: 500 }}>{sLabels[strength]}</span>
                    </div>
                  )}
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--tx-500)", marginBottom: 5 }}>确认密码</label>
                  <div style={{ position: "relative" }}>
                    <FiLock size={15} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--tx-100)" }} />
                    <input type="password" value={form.confirmPassword} onChange={(e) => updateField("confirmPassword", e.target.value)} placeholder="再次输入密码" className="m-input" style={{ paddingLeft: 40 }} />
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--tx-500)", marginBottom: 5 }}>手机号码</label>
                  <div style={{ position: "relative" }}>
                    <FiPhone size={15} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--tx-100)" }} />
                    <input type="tel" value={form.phone} onChange={(e) => updateField("phone", e.target.value)} placeholder="请输入手机号" className="m-input" style={{ paddingLeft: 40 }} />
                  </div>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--tx-500)", marginBottom: 5 }}>从业身份</label>
                  <div style={{ position: "relative" }}>
                    <FiBriefcase size={15} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--tx-100)" }} />
                    <select value={form.medicalRole} onChange={(e) => updateField("medicalRole", e.target.value)} className="m-input" style={{ paddingLeft: 40, cursor: "pointer" }}>
                      <option value="clinical_doctor">临床医生</option>
                      <option value="researcher">科研研究员</option>
                      <option value="student">医学生</option>
                      <option value="admin">系统管理员</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--tx-500)", marginBottom: 5 }}>所属机构</label>
                  <div style={{ position: "relative" }}>
                    <FiHome size={15} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--tx-100)" }} />
                    <input type="text" value={form.institution} onChange={(e) => updateField("institution", e.target.value)} placeholder="如：北京协和医院" className="m-input" style={{ paddingLeft: 40 }} />
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--tx-500)", marginBottom: 5 }}>专业科室</label>
                    <select value={form.department} onChange={(e) => updateField("department", e.target.value)} className="m-input" style={{ cursor: "pointer" }}>
                      <option value="">请选择</option>
                      <option value="Cardiology">心内科</option>
                      <option value="Oncology">肿瘤科</option>
                      <option value="Neurology">神经内科</option>
                      <option value="Pediatrics">儿科</option>
                      <option value="Surgery">外科</option>
                      <option value="Radiology">放射科</option>
                      <option value="Dermatology">皮肤科</option>
                      <option value="Psychiatry">精神科</option>
                      <option value="Other">其他</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--tx-500)", marginBottom: 5 }}>从业年限</label>
                    <select value={form.yearsOfExperience} onChange={(e) => updateField("yearsOfExperience", e.target.value)} className="m-input" style={{ cursor: "pointer" }}>
                      <option value="">请选择</option>
                      <option value="0-2">0-2年</option>
                      <option value="3-5">3-5年</option>
                      <option value="6-10">6-10年</option>
                      <option value="11-20">11-20年</option>
                      <option value="20+">20年以上</option>
                    </select>
                  </div>
                </div>
                <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer", marginTop: 4 }}>
                  <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} style={{ marginTop: 2, accentColor: "var(--m-cyan)" }} />
                  <span style={{ fontSize: 11, color: "var(--tx-300)", lineHeight: 1.5 }}>我已阅读并同意<button type="button" style={{ background: "none", border: "none", color: "var(--m-primary)", cursor: "pointer", fontSize: 11, padding: 0, textDecoration: "underline" }}>用户隐私协议</button>和<button type="button" style={{ background: "none", border: "none", color: "var(--m-primary)", cursor: "pointer", fontSize: 11, padding: 0, textDecoration: "underline" }}>服务条款</button></span>
                </label>
              </div>
            )}

            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              {step === 2 && (
                <button type="button" onClick={() => setStep(1)} className="m-btn m-btn-secondary" style={{ flex: 1, height: 44 }}>
                  <FiArrowLeft size={14} /> 上一步
                </button>
              )}
              <button type="submit" disabled={loading} className="m-btn m-btn-primary" style={{ flex: 1, height: 44, fontSize: 15 }}>
                {loading ? <div style={{ width: 20, height: 20, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "white", borderRadius: "50%" }} className="anim-spin" /> : step === 1 ? "下一步" : "提交注册"}
              </button>
            </div>
          </form>

          <div style={{ textAlign: "center", marginTop: 10 }}>
            <span style={{ fontSize: 13, color: "var(--tx-300)" }}>已有账号？</span>
            <Link to="/login" style={{ fontSize: 13, color: "var(--m-primary)", textDecoration: "none", fontWeight: 600, marginLeft: 4 }}>立即登录 <FiArrowRight size={12} style={{ display: "inline", verticalAlign: "middle" }} /></Link>
          </div>

          <div style={{ marginTop: 40, textAlign: "center", fontSize: 11, color: "var(--tx-100)", lineHeight: 1.8 }}>
            <p>MedRAG System v1.0 | 医疗文献 RAG 知识库赛事项目</p>
            <p>技术支持: MinerU + LightRAG + MedBench</p>
          </div>
        </div>
      </div>
    </div>
  );
}
