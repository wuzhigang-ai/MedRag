-- 创建用户表
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  union_id VARCHAR(255) NOT NULL UNIQUE,
  name VARCHAR(255),
  email VARCHAR(255),
  avatar TEXT,
  role ENUM('user', 'expert', 'admin') NOT NULL DEFAULT 'expert',
  medical_role VARCHAR(100),
  institution VARCHAR(255),
  department VARCHAR(100),
  years_of_experience INT,
  phone VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_sign_in_at TIMESTAMP
);

-- 创建文献表
CREATE TABLE IF NOT EXISTS articles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  title VARCHAR(500) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  file_size INT,
  file_url TEXT,
  article_type VARCHAR(100),
  status ENUM('pending', 'parsing', 'parsed', 'reviewing', 'approved', 'rejected', 'error') NOT NULL DEFAULT 'pending',
  parsed_content TEXT,
  text_segments_count INT DEFAULT 0,
  figures_count INT DEFAULT 0,
  tables_count INT DEFAULT 0,
  authors JSON,
  publish_date VARCHAR(50),
  journal VARCHAR(255),
  doi VARCHAR(255),
  keywords JSON,
  department VARCHAR(100),
  is_in_knowledge_base INT DEFAULT 0,
  knowledge_nodes_count INT DEFAULT 0,
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  parsed_at TIMESTAMP,
  approved_at TIMESTAMP
);

-- 创建文本片段表
CREATE TABLE IF NOT EXISTS text_segments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  article_id INT NOT NULL,
  sequence INT NOT NULL,
  content TEXT NOT NULL,
  segment_type ENUM('abstract', 'introduction', 'methods', 'results_primary', 'results_secondary', 'subgroup_analysis', 'sensitivity_analysis', 'discussion', 'conclusion', 'references', 'other') NOT NULL DEFAULT 'other',
  section_title VARCHAR(255),
  page_number INT,
  confidence FLOAT,
  word_count INT,
  evidence_level VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 创建提取图表表
CREATE TABLE IF NOT EXISTS extracted_figures (
  id INT AUTO_INCREMENT PRIMARY KEY,
  article_id INT NOT NULL,
  figure_type ENUM('table', 'figure', 'chart', 'image') NOT NULL DEFAULT 'figure',
  sequence INT NOT NULL,
  caption TEXT,
  description TEXT,
  page_number INT,
  confidence FLOAT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 创建知识节点表
CREATE TABLE IF NOT EXISTS knowledge_nodes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  label VARCHAR(255) NOT NULL,
  node_type ENUM('disease', 'drug', 'symptom', 'treatment', 'clinical_indicator', 'anatomy', 'procedure', 'gene', 'pathogen', 'other') NOT NULL DEFAULT 'other',
  description TEXT,
  source_article_ids JSON,
  source_segment_ids JSON,
  icd10_code VARCHAR(50),
  mesh_term VARCHAR(255),
  confidence FLOAT,
  occurrence_count INT DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 创建知识边表
CREATE TABLE IF NOT EXISTS knowledge_edges (
  id INT AUTO_INCREMENT PRIMARY KEY,
  source_node_id INT NOT NULL,
  target_node_id INT NOT NULL,
  relation_type ENUM('treats', 'causes', 'associated_with', 'contraindicated', 'diagnoses', 'prevents', 'symptom_of', 'interacts_with', 'related_to') NOT NULL DEFAULT 'related_to',
  strength FLOAT DEFAULT 0.5,
  source_article_ids JSON,
  evidence_count INT DEFAULT 1,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 创建聊天会话表
CREATE TABLE IF NOT EXISTS chat_sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  scope_articles JSON,
  scope_categories JSON,
  message_count INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 创建聊天消息表
CREATE TABLE IF NOT EXISTS chat_messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  role ENUM('user', 'assistant', 'system') NOT NULL,
  content TEXT NOT NULL,
  content_type ENUM('text', 'image', 'pdf', 'voice', 'mixed') NOT NULL DEFAULT 'text',
  attachments JSON,
  rag_trace JSON,
  citations JSON,
  rating INT,
  feedback TEXT,
  token_count INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 创建操作日志表
CREATE TABLE IF NOT EXISTS operation_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT,
  user_name VARCHAR(255),
  action VARCHAR(100) NOT NULL,
  target_type VARCHAR(100),
  target_id INT,
  details JSON,
  ip_address VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 创建笔记表
CREATE TABLE IF NOT EXISTS notes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  title VARCHAR(500) NOT NULL,
  content TEXT NOT NULL,
  tags JSON,
  source VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 插入默认用户数据
INSERT INTO users (union_id, name, email, role) VALUES ('admin_001', 'Admin', 'admin@example.com', 'admin');
INSERT INTO users (union_id, name, email, role) VALUES ('expert_001', 'Medical Expert', 'expert@example.com', 'expert');
INSERT INTO users (union_id, name, email, role) VALUES ('user_001', 'Patient', 'user@example.com', 'user');
