import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

const roleLabel = { super_admin: 'Super Admin', teacher: 'Teacher', staff: 'Staff', student: 'Student' };

export default function AppLayout() {
  const { user, logout, can } = useAuth();
  const navigate = useNavigate();
  const signOut = async () => { await logout(); navigate('/login', { replace: true }); };

  return (
    <div className="app">
      <header className="app-bar">
        <span className="brand"><span className="brand-mark" aria-hidden="true">I</span>ISDMS</span>
        <div className="app-user">
          <span>{user.fullName} <small>({roleLabel[user.role] || user.role})</small></span>
          <button className="btn btn-quiet" onClick={signOut}>Sign out</button>
        </div>
      </header>
      <div className="app-body">
        <nav className="app-side" aria-label="Main">
          <NavLink to="/dashboard">Dashboard</NavLink>
          {!user.mustChangePassword && can('users.view') && <NavLink to="/users">Users</NavLink>}
          {!user.mustChangePassword && can('students.view') && <NavLink to="/students">Students</NavLink>}
          {!user.mustChangePassword && user.role === 'student' && <NavLink to="/profile">My profile</NavLink>}
          {!user.mustChangePassword && can('courses.view') && user.role !== 'student' && <NavLink to="/courses">Courses</NavLink>}
          {!user.mustChangePassword && user.role === 'student' && <NavLink to="/my-courses">My courses</NavLink>}
          {!user.mustChangePassword && can('sections.view') && user.role !== 'student' && <NavLink to="/sections">Classes and schedule</NavLink>}
          {!user.mustChangePassword && user.role === 'student' && <NavLink to="/sections/calendar">Academic calendar</NavLink>}
          {!user.mustChangePassword && user.role === 'student' && <NavLink to="/registration">Course registration</NavLink>}
          {!user.mustChangePassword && can('enrollment.view') && <NavLink to="/enrollment">Enrollment</NavLink>}
          {!user.mustChangePassword && user.role === 'teacher' && <NavLink to="/teaching">My classes</NavLink>}
          {!user.mustChangePassword && user.role === 'student' && <NavLink to="/my-attendance">My attendance</NavLink>}
          {!user.mustChangePassword && can('attendance.view') && <NavLink to="/attendance">Attendance</NavLink>}
          {!user.mustChangePassword && user.role === 'student' && <NavLink to="/my-results">My results</NavLink>}
          {!user.mustChangePassword && (can('results.view') || user.role === 'teacher') && <NavLink to="/results">Results</NavLink>}
          {!user.mustChangePassword && user.role === 'student' && <NavLink to="/my-documents">My documents</NavLink>}
          {!user.mustChangePassword && can('documents.view') && <NavLink to="/documents">Documents</NavLink>}
          {!user.mustChangePassword && user.role === 'student' && <NavLink to="/my-fees">My fees</NavLink>}
          {!user.mustChangePassword && can('finance.view') && <NavLink to="/finance">Finance</NavLink>}
          {!user.mustChangePassword && can('structure.view') && <NavLink to="/structure">University structure</NavLink>}
          {!user.mustChangePassword && can('permissions.view') && <NavLink to="/roles">Roles and permissions</NavLink>}
          {!user.mustChangePassword && <NavLink to="/change-password">Change password</NavLink>}
        </nav>
        <main className="app-main"><Outlet /></main>
      </div>
    </div>
  );
}
