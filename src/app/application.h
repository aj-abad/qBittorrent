/*
 * Bittorrent Client using Qt and libtorrent.
 * Copyright (C) 2022  Mike Tzou (Chocobo1)
 * Copyright (C) 2015, 2019  Vladimir Golovnev <glassez@yandex.ru>
 * Copyright (C) 2006  Christophe Dumez
 *
 * This program is free software; you can redistribute it and/or
 * modify it under the terms of the GNU General Public License
 * as published by the Free Software Foundation; either version 2
 * of the License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program; if not, write to the Free Software
 * Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.
 *
 * In addition, as a special exception, the copyright holders give permission to
 * link this program with the OpenSSL project's "OpenSSL" library (or with
 * modified versions of it that use the same license as the "OpenSSL" library),
 * and distribute the linked executables. You must obey the GNU General Public
 * License in all respects for all of the code used other than "OpenSSL".  If you
 * modify file(s), you may extend this exception to your version of the file(s),
 * but you are not obligated to do so. If you do not wish to do so, delete this
 * exception statement from your version.
 */

#pragma once

#include <atomic>

#include <QtSystemDetection>
#include <QCoreApplication>
#include <QPointer>
#include <QStringList>
#include <QTranslator>

#include "base/bittorrent/addtorrentparams.h"
#include "base/interfaces/iapplication.h"
#include "base/path.h"
#include "base/settingvalue.h"
#include "base/types.h"
#include "cmdoptions.h"

class ApplicationInstanceManager;
class FileLogger;

namespace BitTorrent
{
    class Torrent;
}

namespace RSS
{
    class Session;
    class AutoDownloader;
}

using AddTorrentManagerImpl = AddTorrentManager;
using BaseApplication = QCoreApplication;
using BaseIApplication = IApplication;

#ifndef DISABLE_WEBUI
class WebUI;
#endif

class Application final : public BaseApplication, public BaseIApplication
{
    Q_OBJECT
    Q_DISABLE_COPY_MOVE(Application)

public:
    Application(int &argc, char **argv);
    ~Application() override;

    int exec();

    bool hasAnotherInstance() const;
    bool callMainInstance();
    const QBtCommandLineParameters &commandLineArgs() const;

    QString instanceName() const override;
    void setInstanceName(const QString &name) override;

    qint64 launchTimeSecsSinceEpoch() const override;

    // FileLogger properties
    bool isFileLoggerEnabled() const override;
    void setFileLoggerEnabled(bool value) override;
    Path fileLoggerPath() const override;
    void setFileLoggerPath(const Path &path) override;
    bool isFileLoggerBackup() const override;
    void setFileLoggerBackup(bool value) override;
    bool isFileLoggerDeleteOld() const override;
    void setFileLoggerDeleteOld(bool value) override;
    int fileLoggerMaxSize() const override;
    void setFileLoggerMaxSize(int bytes) override;
    int fileLoggerAge() const override;
    void setFileLoggerAge(int value) override;
    int fileLoggerAgeType() const override;
    void setFileLoggerAgeType(int value) override;

    int memoryWorkingSetLimit() const override;
    void setMemoryWorkingSetLimit(int size) override;

    void sendTestEmail() override;

#ifdef Q_OS_WIN
    MemoryPriority processMemoryPriority() const override;
    void setProcessMemoryPriority(MemoryPriority priority) override;
#endif

private slots:
    void processMessage(const QString &message);
    void torrentAdded(const BitTorrent::Torrent *torrent) const;
    void torrentFinished(const BitTorrent::Torrent *torrent);
    void allTorrentsFinished();
    void cleanup();

private:
    AddTorrentManagerImpl *addTorrentManager() const override;
#ifndef DISABLE_WEBUI
    WebUI *webUI() const override;
#endif

    void initializeTranslation();
    void processParams(const QBtCommandLineParameters &params);
    void runExternalProgram(const QString &programTemplate, const BitTorrent::Torrent *torrent) const;
    void sendNotificationEmail(const BitTorrent::Torrent *torrent);

#if defined(QBT_USES_LIBTORRENT2) && !defined(Q_OS_MACOS)
    void applyMemoryWorkingSetLimit() const;
#endif

#ifdef Q_OS_WIN
    void applyMemoryPriority() const;
    void adjustThreadPriority() const;
#endif

    ApplicationInstanceManager *m_instanceManager = nullptr;
    std::atomic_bool m_isCleanupRun;
    bool m_isProcessingParamsAllowed = false;
    ShutdownDialogAction m_shutdownAct = ShutdownDialogAction::Exit;
    QBtCommandLineParameters m_commandLineArgs;
    qint64 m_launchTimeSecsSinceEpoch = -1;

    // FileLog
    QPointer<FileLogger> m_fileLogger;

    QTranslator m_qtTranslator;
    QTranslator m_translator;

    QList<QBtCommandLineParameters> m_paramsQueue;

    SettingValue<QString> m_storeInstanceName;
    SettingValue<bool> m_storeFileLoggerEnabled;
    SettingValue<bool> m_storeFileLoggerBackup;
    SettingValue<bool> m_storeFileLoggerDeleteOld;
    SettingValue<int> m_storeFileLoggerMaxSize;
    SettingValue<int> m_storeFileLoggerAge;
    SettingValue<int> m_storeFileLoggerAgeType;
    SettingValue<Path> m_storeFileLoggerPath;
    SettingValue<int> m_storeMemoryWorkingSetLimit;

#ifdef Q_OS_WIN
    SettingValue<MemoryPriority> m_processMemoryPriority;
#endif

    AddTorrentManagerImpl *m_addTorrentManager = nullptr;

#ifndef DISABLE_WEBUI
    WebUI *m_webui = nullptr;
#endif
};
