﻿// <copyright file="DatabaseClient.cs" company="Microsoft">
// Copyright (c) Microsoft Corporation. All rights reserved.
// </copyright>

namespace Tim.Backend.Providers.Database
{
    using System;
    using System.Collections.Generic;
    using System.Linq;
    using System.Threading.Tasks;

    using Couchbase;
    using Couchbase.Core.Exceptions.KeyValue;
    using Couchbase.Management.Collections;
    using Couchbase.Management.Query;
    using Newtonsoft.Json;
    using Serilog;
    using Tim.Backend.Models.KustoQuery;
    using Tim.Backend.Models.Templates;
    using Tim.Backend.Providers.DbModels;
    using Tim.Backend.Startup.Config;

    /// <summary>
    /// Outlines the Database Client used byt the service.
    /// </summary>
    public class DatabaseClient : IDatabaseClient
    {
        /// <summary>
        /// Initializes a new instance of the <see cref="DatabaseClient"/> class.
        /// </summary>
        /// <param name="type">Database type.</param>
        /// <param name="secrets">Connection string.</param>
        /// <param name="configs">Collection/table names.</param>
        public DatabaseClient(
            DatabaseClientType type,
            AzureResourcesSectionSecrets secrets,
            DatabaseClasses configs)
        {
            Logger = Log.Logger;
            Logger.Information($"DatabaseClient is starting up for bucket {configs.DatabaseName} scope {configs.Scope}. ");
            if (type.Equals(DatabaseClientType.CouchBaseDb))
            {
                CouchBaseClient = Cluster.ConnectAsync(
                    secrets.DatabaseConnection,
                    new ClusterOptions
                    {
                        UserName = secrets.DbUserName,
                        Password = secrets.DbUserPassword,
                        KvTimeout = TimeSpan.FromSeconds(10),
                    }).GetAwaiter().GetResult();

                CouchBaseClientType = DatabaseClientType.CouchBaseDb;
                Database = configs.DatabaseName;
                Scope = configs.Scope;
                Configs = configs;
            }

            Logger.Information($"DatabaseClient has been created.");
        }

        /// <summary>
        /// Define Database client types.
        /// </summary>
        public enum DatabaseClientType
        {
            /// <summary>
            /// Couch base db client.
            /// </summary>
            CouchBaseDb,
        }

        /// <summary>
        /// Gets or sets the Couchbase db client.
        /// </summary>
        public ICluster CouchBaseClient { get; set; }

        /// <summary>
        /// Gets or sets the Couchbase db client type.
        /// </summary>
        public DatabaseClientType CouchBaseClientType { get; set; }

        /// <summary>
        /// Gets the Couchbase bucket client is connected to.
        /// </summary>
        public string Database { get; }

        /// <summary>
        /// Gets the Couchbase scope client is connected to.
        /// </summary>
        public string Scope { get; }

        /// <summary>
        /// Gets or sets the db configs.
        /// </summary>
        public DatabaseClasses Configs { get; set; }

        /// <summary>
        /// Gets the logger.
        /// </summary>
        protected ILogger Logger { get; }

        /// <summary>
        /// Add or update an item in the database.
        /// </summary>
        /// <typeparam name="T">Object that will be udpated.</typeparam>
        /// <param name="partitionKey">Unique identified of the object.</param>
        /// <param name="jsonObject">Object contents.</param>
        /// <param name="collectionName">Name of the corresponding collection/table.</param>
        /// <returns>Created db object or error.</returns>
        public async Task<T> AddorUpdateItem<T>(string partitionKey, string jsonObject, string collectionName)
            where T : class
        {
            try
            {
                if (CouchBaseClientType == DatabaseClientType.CouchBaseDb)
                {
                    var bucket = await CouchBaseClient.BucketAsync(Database);
                    var scope = await bucket.ScopeAsync(Scope);
                    var collection = await scope.CollectionAsync(collectionName);

                    // TODO there is likely a better way to do this just once at service start up for all collections
                    if (await CheckIfCollectionExists(collectionName, bucket))
                    {
                        collection = await scope.CollectionAsync(collectionName);
                    }

                    var queryRunJsonEntity = new JsonEntity
                    {
                        PartitionKey = partitionKey,
                        Properties = jsonObject,
                    };

                    var upsertResult = await collection.UpsertAsync(partitionKey, jsonObject);
                    var getResult = await collection.GetAsync(partitionKey);

                    return JsonConvert.DeserializeObject<T>(getResult.ContentAs<string>());
                }

                return null;
            }
            catch (Exception e)
            {
                Logger.Error(e, "Database client failed with error: " + e.ToString());
#pragma warning disable CA2200 // Rethrow to preserve stack details

                // TODO rethink how we want to do this, or is logging the error once logging is set up enough, no need to throw?
                throw e;
#pragma warning restore CA2200 // Rethrow to preserve stack details
            }
        }

        /// <summary>
        /// Gets an item from an existing collection based on partition key.
        /// </summary>
        /// <typeparam name="T">Object type.</typeparam>
        /// <param name="partitionKey">Unique condition element is determined by.</param>
        /// <param name="collectionName">Name of the collection/table.</param>
        /// <returns>Item if found, null otherwise.</returns>
        public async Task<T> GetItem<T>(string partitionKey, string collectionName)
            where T : class
        {
            try
            {
                if (CouchBaseClientType == DatabaseClientType.CouchBaseDb)
                {
                    var bucket = await CouchBaseClient.BucketAsync(Database);
                    var scope = await bucket.ScopeAsync(Scope);
                    var collection = await scope.CollectionAsync(collectionName);

                    // TODO there is likely a better way to do this just once at service start up for all collections
                    if (await CheckIfCollectionExists(collectionName, bucket))
                    {
                        collection = await scope.CollectionAsync(collectionName);
                    }

                    var getResult = await collection.GetAsync(partitionKey);

                    return JsonConvert.DeserializeObject<T>(getResult.ContentAs<string>());
                }

                return null;
            }
            catch (DocumentNotFoundException e)
            {
                // element not found
                Logger.Error(e, $"Not able to find element with partition key {partitionKey}: " + e.ToString());
                return null;
            }
            catch (Exception e)
            {
                Logger.Error(e, "Database client failed with error: " + e.ToString());
#pragma warning disable CA2200 // Rethrow to preserve stack details

                // TODO rethink how we want to do this, or is logging the error once logging is set up enough, no need to throw?
                throw e;
#pragma warning restore CA2200 // Rethrow to preserve stack details
            }
        }

        /// <summary>
        /// Returns all item in a given collection.
        /// </summary>
        /// <typeparam name="T">Object type.</typeparam>
        /// <param name="collectionName">Name of the collection/table to query.</param>
        /// <returns>List of items if any are present.</returns>
        public async Task<IEnumerable<T>> GetItems<T>(string collectionName)
            where T : class
        {
            try
            {
                if (CouchBaseClientType == DatabaseClientType.CouchBaseDb)
                {
                    if (typeof(T) == typeof(QueryTemplate) && collectionName == Configs.QueryTemplatesContainerName)
                    {
                        var queryResult = await CouchBaseClient.QueryAsync<QueryTemplateJsonEntity>($"select  * from {Database}.{Scope}.{Configs.QueryTemplatesContainerName}");
                        var rows3 = queryResult.ToListAsync();
                        var result = new List<T>();
                        foreach (var row in rows3.Result)
                        {
                            result.Add(JsonConvert.DeserializeObject<T>(Convert.ToString(row.QueryTemplate)));
                        }

                        return result;
                    }

                    if (typeof(T) == typeof(KustoQueryRun) && collectionName == Configs.QueryRunsContainerName)
                    {
                        var queryResult = await CouchBaseClient.QueryAsync<QueryRunJsonEntity>($"select  * from {Database}.{Scope}.{Configs.QueryRunsContainerName}");
                        var rows3 = queryResult.ToListAsync();
                        var result = new List<T>();
                        foreach (var row in rows3.Result)
                        {
                            result.Add(JsonConvert.DeserializeObject<T>(Convert.ToString(row.QueryRun)));
                        }

                        return result;
                    }
                }

                return null;
            }
            catch (Exception e)
            {
                Logger.Error(e, "Database client failed with error: " + e.ToString());
#pragma warning disable CA2200 // Rethrow to preserve stack details

                // TODO rethink how we want to do this, or is logging the error once logging is set up enough, no need to throw?
                throw e;
#pragma warning restore CA2200 // Rethrow to preserve stack details
            }
        }

        /// <summary>
        /// Deletes items from a given collection.
        /// </summary>
        /// <typeparam name="T">Object type.</typeparam>
        /// <param name="partitionKey">Unique identified for item to delete.</param>
        /// <param name="collectionName">Name of collection/table.</param>
        public async void DeleteItem<T>(string partitionKey, string collectionName)
            where T : class
        {
            try
            {
                if (CouchBaseClientType == DatabaseClientType.CouchBaseDb)
                {
                    var bucket = await CouchBaseClient.BucketAsync(Database);
                    var scope = await bucket.ScopeAsync(Scope);
                    var collection = await scope.CollectionAsync(collectionName);

                    await collection.RemoveAsync(partitionKey);
                }
            }
            catch (Exception e)
            {
                Logger.Error(e, "Database client failed with error: " + e.ToString());
#pragma warning disable CA2200 // Rethrow to preserve stack details

                // TODO rethink how we want to do this, or is logging the error once logging is set up enough, no need to throw?
                throw e;
#pragma warning restore CA2200 // Rethrow to preserve stack details
            }
        }

        private async Task<bool> CheckIfCollectionExists(string collectionName, IBucket bucket)
        {
            var collectionMgr = bucket.Collections;
            try
            {
                var spec = new CollectionSpec(Scope, collectionName);
                await collectionMgr.CreateCollectionAsync(spec);

                var manager = CouchBaseClient.QueryIndexes;
                await manager.CreatePrimaryIndexAsync(
                    Database,
                    new CreatePrimaryQueryIndexOptions()
                        .ScopeName(Scope)
                        .CollectionName(collectionName)
                        .Deferred(false)
                        .IgnoreIfExists(true));

                return true;
            }
            catch (CollectionExistsException)
            {
                Logger.Information($"Collection {collectionName} already exists.");
                return false;
            }
        }
    }
}