# 项目架构
- 后端：FastAPI + Python 3.11
- 数据库：PostgreSQL 14 + SQLAlchemy
- 测试：pytest，覆盖率必须>90%
- 部署：Docker + nginx

# 重要规范
- 所有API必须有异常处理
- 数据库操作必须用事务
- 新功能必须先写测试
- 绝对不要在代码、UI文本、注释中使用emoji表情符号

# 常用命令
- 启动：uvicorn main:app --reload
- 测试：pytest --cov=src tests/
- 构建：docker build -t myapp .